export default {
  async queue(batch, env, ctx) {
    const writes = batch.messages.map((message) => ({
      id: message.id,
      payload: message.body,
    }));

    const results = await Promise.allSettled(writes.map((write) => validateLarkWrite(write)));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batch.messages[index].ack();
      } else {
        batch.messages[index].retry();
      }
    });
  },
};

async function validateLarkWrite(write) {
  if (!write.payload?.tableName || !write.payload?.record) {
    throw new Error(`Invalid Lark write payload: ${write.id}`);
  }

  return { ok: true, id: write.id };
}
