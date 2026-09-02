import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    // Jeśli repo na GitHubie nazywa się inaczej niż "student-chat",
    // zmień poniżej na "/NAZWA_REPO/".
    base: "/student-chat/"
});
