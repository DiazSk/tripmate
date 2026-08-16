// Fires a fixed set of sample requests at the three LLM-backed features
// (itinerary generate+critique, place-detail, chat edit, plus one rebalance
// per invocation) against a running dev server, then tags every llm_runs row
// created during the run so /backend's Perf Dashboard can diff two labeled
// batches (e.g. "baseline" vs. "after-prompt-tweak").
//
// Usage: node scripts/perf-bench.mjs --label baseline --iterations 3
//
// Each iteration makes several real `claude` CLI calls (real cost, real
// latency) — keep --iterations modest for routine checks.
import { tagRunsCreatedBetween } from "../src/lib/db.ts";

const BASE_URL = process.env.PERF_BENCH_BASE_URL ?? "http://localhost:3000";

function todayISO(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const SCENARIOS = [
  {
    destination: "Paris, France",
    startDate: todayISO(30),
    endDate: todayISO(32),
    budget: 900,
    tier: "midrange",
  },
  {
    destination: "Tokyo, Japan",
    startDate: todayISO(60),
    endDate: todayISO(66),
    budget: 3500,
    tier: "midrange",
  },
];

const CHAT_MESSAGES = [
  { role: "user", content: "Can we make day 1 a bit more relaxed, with a later start?" },
];

function parseArgs(argv) {
  const args = { label: null, iterations: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--label") args.label = argv[++i];
    if (argv[i] === "--iterations") args.iterations = Number(argv[++i]);
  }
  if (!args.label) {
    console.error("Usage: node scripts/perf-bench.mjs --label <name> [--iterations <n>]");
    process.exit(1);
  }
  return args;
}

async function postJson(pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status}: ${data.error ?? "unknown error"}`);
  return data;
}

async function runScenario(scenario) {
  console.log(`[perf-bench] generate: ${scenario.destination}`);
  const { itinerary } = await postJson("/api/itinerary", scenario);

  const firstStop = itinerary.days[0]?.stops?.[0];
  if (firstStop) {
    console.log(`[perf-bench] place-detail: ${firstStop.name}`);
    await postJson("/api/place-detail", {
      name: firstStop.name,
      destination: scenario.destination,
      lat: firstStop.lat,
      lng: firstStop.lng,
    });
  }

  console.log(`[perf-bench] chat edit: ${scenario.destination}`);
  await postJson("/api/trip-edit", {
    mode: "chat",
    trip: {
      id: "perf-bench",
      destination: scenario.destination,
      startDate: scenario.startDate,
      endDate: scenario.endDate,
      budget: scenario.budget,
    },
    itinerary,
    messages: CHAT_MESSAGES,
  });

  return itinerary;
}

async function main() {
  const { label, iterations } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  try {
    let lastItinerary = null;
    for (let i = 0; i < iterations; i++) {
      console.log(`[perf-bench] iteration ${i + 1}/${iterations}`);
      for (const scenario of SCENARIOS) {
        const itinerary = await runScenario(scenario);
        if (scenario === SCENARIOS[0]) lastItinerary = itinerary;
      }
    }

    // One rebalance call per script run (rarer user action than the others —
    // keeps the extra CLI-call cost down).
    console.log("[perf-bench] rebalance");
    await postJson("/api/itinerary", {
      ...SCENARIOS[0],
      rebalance: true,
      remainingDays: lastItinerary.days.slice(1),
      remainingBudget: 200,
    });
  } finally {
    const endedAt = new Date().toISOString();
    const tagged = tagRunsCreatedBetween(label, startedAt, endedAt);
    console.log(`[perf-bench] tagged ${tagged} run(s) as "${label}"`);
  }
}

main().catch((err) => {
  console.error("[perf-bench]", err);
  process.exit(1);
});
