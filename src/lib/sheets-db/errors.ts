// Names the rest of the application uses for data-layer failures. They are aliases of the
// Google client's error types rather than new classes, so `instanceof` works across both the
// storage-agnostic code above and the Google-specific code below.

export { GoogleConfigError as StoreConfigError, GoogleUnavailableError as StoreUnavailableError } from "@/lib/google/errors";
