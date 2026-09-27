import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * Every Better Auth endpoint, mounted in one place.
 *
 * `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`,
 * `/api/auth/get-session` and the rest are all served from this catch-all — the library owns the
 * routing beneath it, so nothing here enumerates them.
 *
 * Note for `src/proxy.ts`: this path is deliberately *not* in `DEV_ONLY_PREFIXES`. It is the one
 * part of the API surface that must answer in production.
 */
export const { GET, POST } = toNextJsHandler(auth);
