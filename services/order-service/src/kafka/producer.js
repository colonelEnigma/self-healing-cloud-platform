const kafka = require("./client");

const producer = kafka.producer();

const connectProducer = async () => {
  const connectWithRetry = async () => {
    const maxRetries = 10;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        console.log(`Kafka connect attempt ${attempt + 1}`);
        await producer.connect();
        console.log("Kafka connected");
        return;
      } catch (err) {
        console.error("Kafka connection failed, retrying...");
        attempt++;
        await new Promise((res) => setTimeout(res, 3000)); // wait 3 sec
      }
    }

    throw new Error("Kafka connection failed after retries");
  };

  await connectWithRetry();
};

const sendMessage = async (topic, message) => {
  try {
    await producer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(message),
        },
      ],
    });
  } catch (err) {
    console.error("Kafka send error:", err.message);
  }
};

module.exports = {
  connectProducer,
  sendMessage,
};
