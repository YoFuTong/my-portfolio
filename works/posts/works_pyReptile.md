# 自己手动开发的爬虫框架

## 1 框架源码

```python

import asyncio
import aiohttp
import redis.asyncio as aioredis
import functools
import hashlib
import json

TIMEOUT = 40
REQUEST_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
}

# ================= 辅助函数：生成唯一请求指纹 =================
def _get_fingerprint(method, url, **kwargs):
    """
    根据 请求方法 + URL + 参数 + 请求体 生成唯一 MD5 指纹
    以此解决 GET/POST 相同 URL，以及 POST 相同 URL 不同 Body 的冲突问题
    """
    params = kwargs.get('params', {})
    data = kwargs.get('data', {})

    # 序列化参数并排序（保证 {"a":1, "b":2} 和 {"b":2, "a":1} 生成相同的指纹）
    # default=str 用于处理非标准的可序列化对象
    params_str = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str) if params else ""
    data_str = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str) if data else ""

    # 拼装原始字符串
    raw_str = f"{method.upper()}:{url}:{params_str}:{data_str}"

    # 计算 MD5
    return hashlib.md5(raw_str.encode('utf-8')).hexdigest()


# ================= 装饰器：带维度的分布式去重 =================
def distributes(method):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(self, url, **kwargs):
            if not self.redis_client:
                return await func(self, url, **kwargs)

            redis_data_dict = 'pyReptile_keys'

            # ========== 1. 处理单个 URL ==========
            if isinstance(url, str):
                fp = _get_fingerprint(method, url, **kwargs)

                if await self.redis_client.hexists(redis_data_dict, fp):
                    return {'status': 0, 'error': 'Duplicated (Redis)', 'url': url}

                result = await func(self, url, **kwargs)
                if isinstance(result, dict) and result.get('status') == 200:
                    await self.redis_client.hset(redis_data_dict, fp, 0)
                return result

            # ========== 2. 处理 URL 列表 (批量) ==========
            elif isinstance(url, list):
                if not url:
                    return []

                pipe = self.redis_client.pipeline()
                fps = []
                for u in url:
                    fp = _get_fingerprint(method, u, **kwargs)
                    fps.append(fp)
                    pipe.hexists(redis_data_dict, fp)

                exists_flags = await pipe.execute()

                final_results = [None] * len(url)
                urls_to_fetch = []
                indices_to_fetch = []
                fps_to_fetch = []

                for i, (u, fp, exists) in enumerate(zip(url, fps, exists_flags)):
                    if exists:
                        final_results[i] = {'status': 0, 'error': 'Duplicated (Redis)', 'url': u}
                    else:
                        urls_to_fetch.append(u)
                        indices_to_fetch.append(i)
                        fps_to_fetch.append(fp)

                if not urls_to_fetch:
                    return final_results

                fetched_results = await func(self, urls_to_fetch, **kwargs)

                if fetched_results:
                    pipe = self.redis_client.pipeline()
                    has_new_data = False

                    # 【核心修复 1】统一异常拦截，确保回填的一定是 dict
                    for idx, fp, res in zip(indices_to_fetch, fps_to_fetch, fetched_results):
                        # 兜底：如果 gather 返回了 Exception 对象（虽然底层已拦截，但防患于未然）
                        if isinstance(res, Exception):
                            res = {'status': 0, 'error': f'Gather Exception: {str(res)}', 'url': url[idx]}

                        final_results[idx] = res

                        if isinstance(res, dict) and res.get('status') == 200:
                            pipe.hset(redis_data_dict, fp, 0)
                            has_new_data = True

                    if has_new_data:
                        await pipe.execute()

                return final_results

        return wrapper

    return decorator


# ================= 爬虫核心类 =================
class Request(object):
    def __init__(self, redis_host=None, redis_port=6379, redis_db=1, max_conn=100):
        self.connector = aiohttp.TCPConnector(limit=max_conn, ssl=False)
        self.session = aiohttp.ClientSession(connector=self.connector, headers=REQUEST_HEADERS)

        self.redis_client = None
        if redis_host:
            self.redis_client = aioredis.Redis(
                host=redis_host, port=redis_port, db=redis_db,
                decode_responses=True, max_connections=50
            )

    # 【核心修复 2】实现异步上下文管理器
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def close(self):
        if self.session:
            try:
                await self.session.close()
            finally:
                if not self.connector.closed:
                    self.connector.close()
        if self.redis_client:
            await self.redis_client.aclose()

    async def _request(self, method, url, **kwargs):
        """底层统一请求，确保绝对不抛出异常"""
        cookies = kwargs.get('cookies', {})
        params = kwargs.get('params', {})
        data = kwargs.get('data', {})
        proxy = kwargs.get('proxy', '') or None
        timeout = aiohttp.ClientTimeout(total=kwargs.get('timeout', TIMEOUT))
        headers = kwargs.get('headers', REQUEST_HEADERS)
        return_json = kwargs.get('return_json', False)

        try:
            async with self.session.request(
                    method=method, url=url, params=params, data=data,
                    proxy=proxy, timeout=timeout, headers=headers, cookies=cookies
            ) as response:

                content_bytes = None
                if kwargs.get('return_content', False):
                    content_bytes = await response.read()

                text_str = await response.text(errors='ignore')

                json_data = None
                if return_json:
                    try:
                        json_data = await response.json(content_type=None)
                    except Exception:
                        json_data = None

                return dict(
                    status=response.status, headers=dict(response.headers),
                    url=str(response.url), text=text_str, content=content_bytes, json=json_data
                )

        except asyncio.TimeoutError:
            return {'status': 0, 'error': 'Timeout', 'url': url}
        except aiohttp.ClientError as e:
            return {'status': 0, 'error': str(e), 'url': url}
        except Exception as e:
            return {'status': 0, 'error': f'Unknown: {str(e)}', 'url': url}

    @distributes(method='GET')
    async def get(self, url, **kwargs):
        if isinstance(url, list):
            tasks = [self._request('GET', u, **kwargs) for u in url]
            # 这里可以不用 return_exceptions，因为 _request 已经兜底了。
            # 但为了双重保险，还是留着，装饰器里也会处理。
            return await asyncio.gather(*tasks, return_exceptions=True)
        return await self._request('GET', url, **kwargs)

    @distributes(method='POST')
    async def post(self, url, **kwargs):
        if isinstance(url, list):
            tasks = [self._request('POST', u, **kwargs) for u in url]
            return await asyncio.gather(*tasks, return_exceptions=True)
        return await self._request('POST', url, **kwargs)

```

## 2 源码介绍
框架整体分为全局配置、辅助函数、去重装饰器和核心类 四个部分。

1. `_get_fingerprint(method, url, **kwargs)`辅助函数，将请求方法(get/post)、`url`、参数(params)、请求体(data)、进行字典排序并
序列化，然后计算`md5`，用来生成请求指纹来解决装饰器去重只根据`url`所造成的误判。
2. `distribus(method)`，分布式去重拦截器，支持单个`url`和批量`url`列表。
如果是单个 URL：直接查 Redis，如果存在直接返回 {'status': 0, 'error': 'Duplicated'}，不存在则真实请求并写回 Redis。
如果是批量 List：利用 Redis Pipeline 批量查重。将列表拆分为“已爬取”和“待爬取”两部分。
高级功能（保证顺序）：预先创建一个与传入列表等长的 final_results，将拦截的 URL 填入占位符，将新请求的结果通过索引 idx 精准回填，最后返回给用户。保证返回的列表长度和顺序与传入的完全一致。
3. `__init__(...)`，类的初始化。创建全局共享的 aiohttp.ClientSession（连接池），并根据传入的参数创建异步的 redis.asyncio 连接池。
4. `__aenter__ / __aexit__`，用于实现异步上下文管理器。
5. `close()`，用于安全关闭所有网络资源
6. `_request(method, url, **kwargs)`，处理超时、代理、Headers、Cookies；使用 try...except 捕获所有网络异常（如超时、连接重置）；按需提取 text、bytes 或解析 json；最终永远返回一个格式统一的标准字典（包含 status, url, text, json, content, error 等键）。
7. `get(url, **kwargs)` 和 `post(url, **kwargs)`，接收字符串或列表，如果是列表，内部使用 asyncio.gather 并发调度 _request，最后被 @distributes 装饰器包装。是框架对外的暴露接口。

## 3 框架的使用
通过上述介绍，相信大家对`pyReptile`这个框架有了一定的了解。

这是框架的使用模板

```python
import asyncio
import sys
from pyReptile import Request

# 【避坑指南】Windows 系统下必须加这两行，避免底层事件循环关闭报错
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

async def main():
    # 推荐使用 async with 自动管理生命周期
    # 如果不传 redis_host，则自动关闭去重功能
    async with Request(redis_host='127.0.0.1', redis_db=0, max_conn=50) as req:
        
        # ==========================================
        # 场景一：单次请求，获取 JSON
        # ==========================================
        res = await req.get("https://httpbin.org/json", return_json=True)
        if res.get('status') == 200:
            print("单次请求结果：", res['json'].get('slideshow', {}).get('title'))
        else:
            print("请求失败：", res.get('error'))

        # ==========================================
        # 场景二：批量请求 (带有去重机制)
        # ==========================================
        urls = [
            "https://httpbin.org/get?a=1",
            "https://httpbin.org/get?a=2"
        ]
        # results 一定是一个长度为 2 的列表，且顺序与 urls 对应
        results = await req.get(urls)
        
        for url, r in zip(urls, results):
            if r.get('status') == 200:
                print(f"成功抓取: {url}")
            elif r.get('status') == 0 and 'Duplicated' in r.get('error', ''):
                print(f"触发 Redis 去重跳过: {url}")
            else:
                print(f"失败: {url}, 原因: {r.get('error')}")

        # ==========================================
        # 场景三：POST 请求 (提交表单或 JSON)
        # ==========================================
        post_res = await req.post(
            "https://httpbin.org/post", 
            data={"name": "张三", "age": 18},
            headers={"Content-Type": "application/json"} # 指定传 JSON
        )
        print("POST 响应:", post_res.get('status'))

if __name__ == "__main__":
    asyncio.run(main())
```

常用参数速查表（kwargs 支持项）

在调用 req.get() 或 req.post() 时，你可以传入以下关键字参数：

|     参数名     | 类型    |	默认值|	作用 |
| --------------|-------|-------|---------|
|params	        | dict	 |    {} |	URL 拼接参数 (例如 ?a=1&b=2)|
|data	        | dict	 |    {} |	POST 提交的表单体或 JSON 数据|
|headers        | dict	 |全局默认 |	自定义请求头（常用于伪装 UA、传 Token）|
|cookies        | dict	 |    {} |	自定义 Cookies|
|proxy	        | str	  |   None|	代理 IP，格式需带协议如 `http://127.0.0.1:8080` |
|timeout        | int	  |    40 |	请求超时时间（秒）                                                     |
|return_json	| bool	 |  False|	设为 True 时，自动将返回体解析为 JSON 并存放在 `res['json']` 中              |
|return_content	| bool	 |  False|	设为 True 时，将返回的二进制字节流存放到 `res['content']` 中（下载图片/视频时用）|

## 4 总结

目前`pyReptile`还处于雏形阶段，框架还有许多功能还没有完善，爬虫可以细分为"数据采集"、“数据清洗”、和“数据入库”三个步骤，目前`pyReptile`只实现了数据采集。

在实际生产时只有小型项目可以用`pyReptile`，在大型复杂项目里还是建议使用`scrapy`这类比较成熟的框架。