import { request } from "https";

const PROJECT_REF = "aqqvreopgqsfykfhuaot";
const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;

const sql = `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name;
`;

const body = JSON.stringify({ query: sql });
const options = {
  hostname: "api.supabase.com",
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Length": Buffer.byteLength(body),
  },
};

const req = request(options, (res) => {
  let data = "";
  res.on("data", (c) => (data += c));
  res.on("end", () => {
    const rows = JSON.parse(data);
    console.log("Tables in public schema:");
    rows.forEach((r) => console.log(" ✅ ", r.table_name));
  });
});
req.on("error", (e) => console.error(e));
req.write(body);
req.end();
