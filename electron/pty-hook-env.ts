// The hook env/URL builder lives in src/shared/concourse-hook-env.ts as the
// single source of truth. Re-exported here to preserve existing electron/
// import paths and tests.
export {
  type PtyHookEnv,
  LOCAL_HOOK_API_HOST,
  AGENT_LOCAL_HOOK_API_HOST,
  buildConcourseApiUrl,
  buildLocalConcourseApiUrl,
  buildAgentLocalHookApiUrl,
  hookEndpointSlug,
  buildSyntheticHookUrl,
} from "../src/shared/concourse-hook-env";
