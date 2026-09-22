import { Platform } from "react-native";

// EXPO_PUBLIC_API_BASE_URL overrides everything — set it in mobile/.env for a physical device
// or a deployed backend. The defaults below are dev-only fallbacks: the Android emulator's
// loopback to the host machine is 10.0.2.2, never localhost — that is an emulator quirk, not
// a bug in this file.
const DEV_DEFAULT = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

export const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEV_DEFAULT;
