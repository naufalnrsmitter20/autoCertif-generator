import { prisma } from "../lib/prisma";
import { hashPassword, validatePassword } from "../lib/password";
import { UserRole } from "../generated/prisma/client";

async function main() {
  const emailInput = process.env.ADMIN_EMAIL;
  const passwordInput = process.env.ADMIN_PASSWORD;

  if (!emailInput || !passwordInput) {
    console.error(
      "Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required."
    );
    process.exit(1);
  }

  const normalizedEmail = emailInput.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    console.error("Error: ADMIN_EMAIL is not a valid email address.");
    process.exit(1);
  }

  const passwordValidation = validatePassword(passwordInput);
  if (!passwordValidation.valid) {
    console.error(`Error: ${passwordValidation.reason}`);
    process.exit(1);
  }

  const existingAdmins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
  });

  if (existingAdmins.length === 0) {
    const passwordHash = await hashPassword(passwordInput);
    await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: UserRole.ADMIN,
      },
    });
    console.log(
      `[ADMIN PROVISION] Successfully created initial ADMIN account for ${normalizedEmail}.`
    );
    return;
  }

  if (existingAdmins.length === 1) {
    const existing = existingAdmins[0];
    if (existing.email === normalizedEmail) {
      const passwordHash = await hashPassword(passwordInput);
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash },
      });
      console.log(
        `[ADMIN PROVISION] Successfully updated credentials for existing ADMIN account: ${normalizedEmail}.`
      );
      return;
    }

    console.error(
      `[ADMIN PROVISION CONFLICT] An existing ADMIN account with email "${existing.email}" already exists. Target ADMIN_EMAIL is "${normalizedEmail}". Identity mutation aborted to prevent unintended changes.`
    );
    process.exit(1);
  }

  console.error(
    `[ADMIN PROVISION CONFLICT] Found ${existingAdmins.length} ADMIN accounts in the database. Aborting to prevent inconsistent state.`
  );
  process.exit(1);
}

main()
  .catch((err) => {
    console.error("[ADMIN PROVISION ERROR]", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
