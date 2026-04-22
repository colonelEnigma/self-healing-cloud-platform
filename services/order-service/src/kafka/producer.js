const kafka = require("./client");

const ORDER_CREATED_TOPIC = process.env.ORDER_CREATED_TOPIC || "order_created";

let producer;

if (kafka) {
  producer = kafka.producer();
}

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
        console.error("Kafka connection failed, retrying...", err.message);
        attempt++;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }

    throw new Error("Kafka connection failed after retries");
  };

  await connectWithRetry();
};

const sendMessage = async (topic, message) => {
  try {
    const finalTopic = topic || ORDER_CREATED_TOPIC;

    await producer.send({
      topic: finalTopic,
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
  ORDER_CREATED_TOPIC,
};