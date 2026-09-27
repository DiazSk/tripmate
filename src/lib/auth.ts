import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { SqliteDialect } from "kysely";
import { randomUUID } from "crypto";
import { claimAnonymousOwner, rawDb } from "./db";
import { LEGACY_OWNER, OWNER_COOKIE, isValidOwnerId } from "./owner";

/**
 * Real accounts, attached exactly where this app said they would attach.
 *
 * `src/lib/owner.ts` already scopes every trip, saved place and profile to an id minted into a
 * cookie, and states in as many words that it "deliberately is NOT an authorization boundary" and
 * that "if real accounts arrive, this column is where they attach". This is that arrival. Better
 * Auth owns users, passwords and sessions; `currentOwnerId()` prefers a verified session over the
 * cookie; not one of the ~31 routes below it learns that accounts exist.
 *
 * **It shares the app's one database connection.** Kysely's `SqliteDialect` wants precisely the
 * better-sqlite3 surface — `prepare`/`all`/`run` — that `libsql` provides and that `db.ts` is
 * built on, so auth runs over `rawDb` rather than opening a second handle on the same file. That
 * matters here specifically: `db.ts` records this repo already losing a build to SQLITE_BUSY from
 * nine workers contending on one file, and a second connection is more of the same cause.
 *
 * It also means Turso works for free — `rawDb` is already the hosted connection when
 * `TURSO_DATABASE_URL` is set, so auth follows the database the rest of the app is using with no
 * second configuration story.
 */
export const auth = betterAuth({
  // The four tables are created by `db.ts` at import, with every other table in this app and for
  // the reason given there. Better Auth's own migrator is never run at runtime.
  database: { dialect: new SqliteDialect({ database: rawDb }), type: "sqlite" },

  emailAndPassword: { enabled: true },

  /**
   * The app's own scheme, alongside the web origin Better Auth trusts by default.
   *
   * Better Auth validates `Origin` against this list, but **only on a request that carries a
   * `Cookie` header** (`origin-check.mjs`: `if (!(forceValidate || useCookies)) return`). A native
   * request carrying nothing but a bearer token therefore skips the check entirely — which would
   * be a fine thing to rely on anywhere except here. This is the app whose cookie store was caught
   * attaching ids the client never set (`mobile/src/api/session.ts`), so "the mobile app sends no
   * cookie" is precisely the assumption this codebase has already watched fail. The RN client
   * sends `Origin: tripmate://` and this trusts it, so sign-in works whether or not the platform
   * decides to put a cookie on the request.
   */
  trustedOrigins: ["tripmate://", "exp://**"],

  /**
   * Native clients carry the session in a header, and that is not a preference.
   *
   * `mobile/src/api/session.ts` documents — from an observed failure, not a guess — React
   * Native's cookie store *overwriting* a hand-set `Cookie` header with stale ids it had collected
   * itself, which is the entire reason `X-TripMate-Owner` exists. Better Auth's Expo plugin
   * attaches sessions the exact way that broke. A bearer token travels in a header the platform
   * has no opinion about, same as the owner id already does.
   */
  plugins: [bearer()],

  /**
   * UUIDs, and this is load-bearing rather than cosmetic.
   *
   * A signed-in user's id *becomes* the `owner_id` on their rows, and `isValidOwnerId()` accepts
   * only a UUIDv4 or the legacy sentinel. Better Auth's own ids are neither. Without this, every
   * owner value a real account produced would fail that check — `proxy.ts` would refuse to fold
   * it, `resolveOwnerId` would drop it, and a signed-in traveller would silently land in the
   * shared legacy bucket instead of their own account.
   */
  advanced: { database: { generateId: () => randomUUID() } },

  databaseHooks: {
    session: {
      create: {
        /**
         * Hand this visitor's anonymous work to the account they just authenticated as.
         *
         * On session *creation*, so it covers sign-up and every later sign-in — which is what
         * makes signing in on a second device pull that device's anonymous trips in too.
         *
         * The anonymous id is read from the owner cookie, and that one read serves both clients:
         * `proxy.ts` folds the mobile app's `X-TripMate-Owner` header into this same cookie
         * before anything downstream looks, so there is no mobile-specific claim path.
         *
         * **Best-effort on purpose.** The traveller is authenticated by the time this runs;
         * refusing them entry because an older row could not be moved is strictly the worse
         * outcome. `claimAnonymousOwner` is idempotent and re-runs on the next sign-in.
         */
        after: async (session, ctx) => {
          try {
            const anonymous = ctx?.getCookie?.(OWNER_COOKIE);
            if (!anonymous || !isValidOwnerId(anonymous)) return;
            if (anonymous === LEGACY_OWNER) return;
            claimAnonymousOwner(anonymous, session.userId);
          } catch {
            // Swallowed deliberately — see above. A failed claim must never fail a sign-in.
          }
        },
      },
    },
  },
});
