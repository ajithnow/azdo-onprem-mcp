import "axios";

declare module "axios" {
  interface InternalAxiosRequestConfig {
    mcpRequestStart?: number;
  }
}
