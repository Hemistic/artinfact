export * from "./selection-translation-service.mjs";

async function main() {
  const service = await import("./selection-translation-service.mjs");
  if (typeof service.runSelectionTranslationCli === "function") {
    await service.runSelectionTranslationCli(process.argv.slice(2));
    return;
  }
  throw new Error("selection translation CLI entry is unavailable");
}

const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  typeof window === "undefined" &&
  import.meta.url.split("/").pop() === process.argv[1].replace(/\\/g, "/").split("/").pop();

if (isMainModule) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
