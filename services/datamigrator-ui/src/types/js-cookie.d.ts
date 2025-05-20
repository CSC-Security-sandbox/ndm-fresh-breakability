declare module "js-cookie" {
  interface Cookies {
    get(name: string): string | undefined;
    set(
      name: string,
      value: string,
      options?: {
        expires?: number | Date;
        path?: string;
        domain?: string;
        secure?: boolean;
        sameSite?: "strict" | "lax" | "none";
      }
    ): void;
    remove(name: string, options?: { path?: string; domain?: string }): void;
  }

  const Cookies: Cookies;
  export default Cookies;
}
