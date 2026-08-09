import "dotenv/config";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { bootstrapData } from "./config/bootstrap";
import { runScheduler } from "./services/scheduler.service";

const port = process.env.PORT || 8100;

async function main() {
  await dbConnect();
  await bootstrapData();
  await runScheduler();

  setInterval(() => void runScheduler().catch((error) => console.error("Scheduler error", error)), 60_000).unref();

  const { server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
