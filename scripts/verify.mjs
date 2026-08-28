import { readFile } from "node:fs/promises";

const files = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../questionnaire.html", import.meta.url), "utf8"),
  readFile(new URL("../entrega-qcphnslvkr9g1fsp.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8")
]);

const [index, questionnaire, delivery, app] = files;
const checks = {
  portal: index.includes("Plataforma unificada"),
  questionnaire: questionnaire.includes("Cuestionario para integrantes fundadores"),
  fortyQuestions: questionnaire.includes("40 preguntas"),
  encryptedDelivery: delivery.includes("location.replace"),
  rafaelAccess: app.includes("RAFAEL TOLEDO NAVARRO"),
  ivanAccess: app.includes("IVAN PUENTES"),
  exports: ["json", "txt", "xml"].every((format) => app.includes(`data-format=\"${format}\"`))
};

if (Object.values(checks).some((value) => !value)) {
  console.error(checks);
  process.exit(1);
}

console.log(JSON.stringify(checks));
