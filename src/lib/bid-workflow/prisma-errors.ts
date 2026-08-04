/** Prisma unique constraint violation */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    String((err as { code: unknown }).code) === "P2002"
  );
}
