import { Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import StudentJoin from "./pages/StudentJoin";
import StudentChat from "./pages/StudentChat";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherPanel from "./pages/TeacherPanel";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">💬 Mam pytanko</Link>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join" element={<StudentJoin />} />
          <Route path="/chat/:threadId" element={<StudentChat />} />
          <Route path="/teacher" element={<TeacherLogin />} />
          <Route path="/teacher/panel" element={<TeacherPanel />} />
        </Routes>
      </main>
    </div>
  );
}
