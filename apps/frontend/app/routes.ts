import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/splash.tsx"),
  route(":logbookId", "routes/logbook.tsx"),
  route(":logbookId/:entryId", "routes/entry.tsx"),
] satisfies RouteConfig;
