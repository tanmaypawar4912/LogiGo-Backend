import { env } from "./config/env.js";
import connectDB from "./config/db.js";
import app from "./app.js";
import { startDispatchWorker } from "./services/dispatchService.js";

const startServer = async () => {
  try {
    await connectDB();

    // Start the periodic auto-dispatch sweep only after MongoDB is connected.
    // The dispatcher uses a database lease so duplicate workers cannot create
    // duplicate offers for the same pending booking.
    startDispatchWorker();

    app.listen(env.PORT, () => {
      console.log(`LogiGo API running on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();
