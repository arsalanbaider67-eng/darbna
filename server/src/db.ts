import { SQL } from "bun";

export type Db = InstanceType<typeof SQL>;

export function connect(url: string): Db {
  return new SQL({ url, max: 10, idleTimeout: 30 });
}
