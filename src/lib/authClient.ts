"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser half of auth.
 *
 * No `baseURL`: the web app is served from the same origin as `/api/auth`, and hardcoding one is
 * how a deploy ends up posting its sign-ins at localhost. The mobile app is the caller that does
 * need an explicit base, and it has its own client for that reason.
 */
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut } = authClient;
