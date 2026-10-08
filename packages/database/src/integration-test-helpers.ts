export async function expectIntegrationRollback(transaction: Promise<unknown>, rollbackMarker: Error): Promise<void> {
  try {
    await transaction;
  } catch (error) {
    if (error === rollbackMarker || (error instanceof Error && error.message === rollbackMarker.message)) return;
    throw error;
  }

  throw new Error(`Expected integration transaction to roll back with "${rollbackMarker.message}".`);
}
