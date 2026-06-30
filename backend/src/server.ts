import app from "./app.js";
import { startScheduler } from "./scheduler.js";

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Economic data API listening on http://localhost:${port}`);
  startScheduler();
});
