import { createApp } from "./routes.js";
import { settings } from "./config.js";

const app = createApp();
app.listen(settings.port, settings.host, () => {
  console.log(`→ http://${settings.host === "0.0.0.0" ? "localhost" : settings.host}:${settings.port}`);
});
