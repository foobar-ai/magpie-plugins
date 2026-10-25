// A CodeBuddy API key is a second way in beside a browser or desktop
// sign-in: magpie keeps it as {type: "api", key} and the loader sends it,
// with no OAuth token to renew and no billing endpoint to read. These tests
// keep the two paths apart, and check that a key never carries a sign-in's
// identity headers.
import { afterAll, afterEach, expect, test } from "bun:test"
import { WorkBuddyAuthPlugin, WorkBuddyAIAuthPlugin, _internal } from "./index.mjs"

const real = globalThis.fetch
const offline = async () => {
  throw new Error("no network in tests")
}
globalThis.fetch = offline
afterEach(() => {
  globalThis.fetch = offline
})
afterAll(() => {
  globalThis.fetch = real
})

const KEY = "ck_test_key"
const apiAuth = { type: "api", key: KEY }
const CHAT_CN = "https://copilot.tencent.com/v2/chat/completions"
const CHAT_AI = "https://www.workbuddy.ai/v2/chat/completions"
const STREAM =
  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
const answer = () => new Response(STREAM, { headers: { "content-type": "text/event-stream" } })

// asked runs one request through the plugin's api loader, collecting the
// calls the loader made; the plugin defaults to the China build. The URL is
// a model's own api.url, as the AI SDK gives it to the loader.
async function asked({ plugin = WorkBuddyAuthPlugin, auth = apiAuth, reply = answer, url = CHAT_CN } = {}) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url instanceof Request ? url.url : url), headers: new Headers(init?.headers), body: init?.body })
    return reply(url, init)
  }
  const hooks = await plugin({ client: {} })
  const loader = await hooks.auth.loader(async () => auth)
  const body = JSON.stringify({
    model: "deepseek-v4.1-flash",
    stream: true,
    max_completion_tokens: 256,
    messages: [
      { role: "developer", content: "You are a coding assistant." },
      { role: "user", content: "Say ok." },
    ],
  })
  const res = await loader.fetch(url, { method: "POST", body })
  return { res, calls, loader, hooks }
}

test("both builds offer a CodeBuddy API key method, with no exchange", async () => {
  for (const plugin of [WorkBuddyAuthPlugin, WorkBuddyAIAuthPlugin]) {
    const hooks = await plugin({ client: {} })
    const method = hooks.auth.methods.find((m) => m.type === "api")
    expect(method).toBeDefined()
    expect(method.label).toBe("CodeBuddy API key")
    expect(method.authorize).toBeUndefined()
    // the two sign-in ways are still there
    expect(hooks.auth.methods.filter((m) => m.type === "oauth").length).toBe(2)
  }
})

test("a key's chats go to that build's CodeBuddy gateway, not WorkBuddy's", async () => {
  const cn = await asked()
  expect(cn.loader.baseURL).toBe("")
  expect(cn.calls[0].url).toBe("https://www.codebuddy.cn/v2/chat/completions")

  const ai = await asked({ plugin: WorkBuddyAIAuthPlugin, url: CHAT_AI })
  expect(ai.loader.baseURL).toBe("")
  expect(ai.calls[0].url).toBe("https://www.codebuddy.ai/v2/chat/completions")
})

test("a Claude model's Messages path keeps /v1 on the key's gateway", async () => {
  const { calls } = await asked({ url: "https://copilot.tencent.com/v1/messages" })
  expect(calls[0].url).toBe("https://www.codebuddy.cn/v1/messages")
  expect(calls[0].headers.get("x-api-key")).toBe(KEY)
})

test("a key is sent as X-Api-Key and as a bearer token, with the build's domain and client identity", async () => {
  const { res, calls } = await asked()
  expect(res.status).toBe(200)
  expect(await res.text()).toBe(STREAM)
  const h = calls[0].headers
  expect(h.get("x-api-key")).toBe(KEY)
  expect(h.get("authorization")).toBe("Bearer " + KEY)
  expect(h.get("x-domain")).toBe("www.codebuddy.cn")
  expect(h.get("x-product")).toBe("SaaS")
  expect(h.get("x-ide-type")).toBe("CodeBuddy")
  expect(h.get("user-agent")).toBe("CodeBuddy/" + _internal.API_KEY_VERSION)
  // no sign-in's identity goes with a key
  expect(h.get("x-user-id")).toBeNull()
  expect(h.get("x-enterprise-id")).toBeNull()
  expect(h.get("x-tenant-id")).toBeNull()
  expect(h.get("x-refresh-token")).toBeNull()

  const ai = await asked({ plugin: WorkBuddyAIAuthPlugin })
  expect(ai.calls[0].headers.get("x-domain")).toBe("www.codebuddy.ai")
  expect(ai.calls[0].headers.get("x-agent-type")).toBe("main")
})

test("a key's chat is shaped as a sign-in's is", async () => {
  const { calls } = await asked()
  const sent = JSON.parse(calls[0].body)
  expect(sent.max_tokens).toBe(256)
  expect(sent.max_completion_tokens).toBeUndefined()
  expect(sent.messages[0].role).toBe("system")
  expect(sent.messages[1]).toEqual({ role: "user", content: "Say ok." })
  // the conversation's ids are set, as for a sign-in
  expect(calls[0].headers.get("x-request-id")).toBeTruthy()
})

test("a 401 is passed on as it is, without a refresh to spend", async () => {
  const seen = []
  const { res } = await asked({
    reply: (url) => {
      seen.push(String(url))
      return new Response('{"error":{"message":"invalid api key"}}', { status: 401, headers: { "content-type": "application/json" } })
    },
  })
  expect(res.status).toBe(401)
  expect(res.headers.get("X-Magpie-Sign-In")).toBeNull()
  expect(await res.text()).toContain("invalid api key")
  // one request only: no /plugin/auth/token/refresh behind a key
  expect(seen.length).toBe(1)
  expect(seen[0]).not.toContain("/plugin/auth/")
})

test("a key's quota asks nothing of WorkBuddy's billing endpoints", async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response("")
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const usage = await hooks.auth.usage(async () => apiAuth)
  expect(called).toBe(false)
  expect(usage).toEqual({ plan: "CodeBuddy API key", windows: [], signIn: "kept" })
})

test("a key's models are the build's list, without asking /v3/config", async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    throw new Error("no network in tests")
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const list = { "deepseek-v4.1-flash": { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash" } }
  const models = await hooks.provider.models({ id: "workbuddy", models: list }, { auth: apiAuth })
  expect(called).toBe(false)
  expect(models).toBe(list)
})

test("a sign-in leaves the URL to the model's own api: chat on /v2, Claude on /v1", async () => {
  const signedIn = async () => ({
    type: "oauth",
    access: "access",
    refresh: "refresh",
    expires: Date.now() + 3600_000,
    uid: "u1",
  })
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const loader = await hooks.auth.loader(signedIn)
  expect(loader.baseURL).toBe("")
  const site = _internal.SITES.workbuddy
  expect(_internal.modelOf(site, { id: "workbuddy" }, { id: "deepseek-v4.1-flash", name: "Deepseek" }).api.url).toBe(
    "https://copilot.tencent.com/v2",
  )
  expect(_internal.modelOf(site, { id: "workbuddy" }, { id: "claude-opus-5.5", name: "Claude" }).api.url).toBe(
    "https://copilot.tencent.com/v1",
  )

  const ai = await WorkBuddyAIAuthPlugin({ client: {} })
  const aiLoader = await ai.auth.loader(signedIn)
  expect(aiLoader.baseURL).toBe("")
  expect(_internal.nativeOf(_internal.SITES["workbuddy-ai"], "claude-opus-5.5")).toBe(false)
})

test("a key that is empty is refused before anything is sent", async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response("")
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: "   " }))
  await expect(loader.fetch("https://www.codebuddy.cn/v2/chat/completions", { method: "POST", body: "{}" })).rejects.toThrow(
    "WorkBuddy's CodeBuddy API key isn't set",
  )
  expect(called).toBe(false)
})
