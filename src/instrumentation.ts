/**
 * Captures the component stack behind server-render errors.
 *
 * Production only reports an error digest (e.g. `4125324827`), which is not
 * enough to locate a fault. `onRequestError` fires with the originating request
 * and the React component stack, so the next occurrence identifies itself.
 */
export async function onRequestError(
  err: unknown,
  request: {
    path: string
    method: string
    headers: { [key: string]: string | undefined }
  },
  context: {
    routerKind: string
    routePath: string
    routeType: string
    renderSource?: string
  }
) {
  const error = err as { message?: string; digest?: string; stack?: string } | undefined

  console.error(
    JSON.stringify({
      tag: "onRequestError",
      digest: error?.digest,
      message: error?.message,
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
      renderSource: context.renderSource,
      // The component stack is the part the digest hides.
      stack: error?.stack?.split("\n").slice(0, 25).join("\n"),
    })
  )
}
