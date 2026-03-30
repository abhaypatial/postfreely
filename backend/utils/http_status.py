"""PostFreely — Utils: HTTP status codes"""
TEXTS = {
    200:"OK",201:"Created",204:"No Content",301:"Moved Permanently",302:"Found",
    304:"Not Modified",400:"Bad Request",401:"Unauthorized",403:"Forbidden",
    404:"Not Found",405:"Method Not Allowed",409:"Conflict",422:"Unprocessable Entity",
    429:"Too Many Requests",500:"Internal Server Error",502:"Bad Gateway",
    503:"Service Unavailable",504:"Gateway Timeout",
}
def text(code): return TEXTS.get(code,"Unknown")
def is_success(code): return 200<=code<300
