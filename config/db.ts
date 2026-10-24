import dns from 'dns';
import mongoose from 'mongoose';

const connect = () => mongoose.connect(process.env.MONGO_URI as string);

const connectDB = async (): Promise<void> => {
  try {
    let conn;
    try {
      conn = await connect();
    } catch (error: any) {
      // Node's resolver can fall back to 127.0.0.1 when it can't read the system DNS
      // config (hotspots, VPNs), which breaks mongodb+srv lookups. Retry with public DNS.
      if (error.syscall !== 'querySrv') throw error;
      console.warn('SRV lookup failed with system DNS, retrying with public DNS...');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      conn = await connect();
    }
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error: any) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
