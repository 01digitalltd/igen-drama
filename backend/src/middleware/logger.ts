import type { MiddlewareHandler } from 'hono'

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

function statusColor(status: number): string {
  if (status >= 500) return colors.red
  if (status >= 400) return colors.yellow
  if (status >= 300) return colors.cyan
  return colors.green
}

function formatTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function isHealthProbe(path: string): boolean {
  return path === '/health' || path.endsWith('/health')
}

/**
 * 全局日志中间件 — 打印请求方法/路径/状态/耗时/请求体
 * 成功的 health probe（k8s/docker）不记 access log，避免刷屏。
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  const path = c.req.path
  const start = performance.now()
  const quiet = isHealthProbe(path)

  const time = formatTime()
  let bodyInfo = ''
  if (!quiet && ['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      const clone = c.req.raw.clone()
      const text = await clone.text()
      if (text) {
        const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text
        bodyInfo = `\n  ${colors.dim}body: ${truncated}${colors.reset}`
      }
    } catch {}
  }

  if (!quiet) {
    console.log(`${colors.dim}${time}${colors.reset} ${colors.cyan}${method}${colors.reset} ${path}${bodyInfo}`)
  }

  await next()

  const status = c.res.status
  if (quiet && status < 400) {
    return
  }

  const ms = (performance.now() - start).toFixed(0)
  const sc = statusColor(status)
  console.log(`${colors.dim}${time}${colors.reset} ${colors.cyan}${method}${colors.reset} ${path} ${sc}${status}${colors.reset} ${colors.dim}${ms}ms${colors.reset}`)
}

/**
 * 全局错误处理 — 捕获未处理异常，打印完整堆栈
 */
export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (err: any) {
    const status = err.status || 500
    console.error(`${colors.red}[ERROR]${colors.reset} ${c.req.method} ${c.req.path}`)
    console.error(err.stack || err.message || err)
    return c.json({ code: status, message: err.message || 'Internal Server Error' }, status as 400)
  }
}
