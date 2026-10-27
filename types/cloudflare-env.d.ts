import type { Env as CrOdontoEnv } from "../api/types";

declare global {
  namespace Cloudflare {
    interface Env extends CrOdontoEnv {}
  }
}
