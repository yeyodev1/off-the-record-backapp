import "dotenv/config";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { bootstrapData } from "./config/bootstrap";
import { publishDueArticles } from "./services/articlePublication.service";

const port = process.env.PORT || 8100;

async function main() {
  await dbConnect();
  await bootstrapData();
  await publishDueArticles();
  setInterval(() => void publishDueArticles(), 60_000).unref();

  const { app, server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
