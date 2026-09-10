import { createApp } from "vue";
import App from "./App.vue";
import { vTooltip } from "./directives/tooltip";
import { installErrorLog, recordError } from "./utils/error-log";
import "./styles/main.css";

installErrorLog();
const app = createApp(App);
app.config.errorHandler = (err, _instance, info) => {
  recordError('vue', err instanceof Error ? `${err.message} (${info})` : String(err));
  console.error(err, info);
};
app.directive('tooltip', vTooltip).mount("#app");
