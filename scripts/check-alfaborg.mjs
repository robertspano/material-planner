import { PrismaClient } from "../src/generated/prisma/index.js";
const p = new PrismaClient();
const c = await p.company.findFirst({ where: { slug: "alfaborg" }, select: { id: true, name: true, logoUrl: true, loginBackgroundUrl: true } });
console.log(JSON.stringify(c, null, 2));
await p.$disconnect();
