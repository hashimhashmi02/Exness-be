import "dotenv/config";
import { prisma } from "./lib/prisma.js";
import bcrypt from "bcrypt";



async function main() {
  const email = "demo@exness.io";
  const exists = await prisma.user.findUnique({ where: { email }});
  if (exists) return console.log("User exists");
  const password = await bcrypt.hash("secret123", 10);
  await prisma.user.create({ data: { email, password }});
  console.log("Seeded:", email, "pwd=secret123");
}
main().finally(()=>process.exit());
