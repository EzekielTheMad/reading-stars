import type { RewardBook } from "./rewards.ts";
// Parent-entered classifications only; no bundled household catalog.
export const rewardCatalog: (RewardBook & {title:string;author:string;format:string})[] = [];
