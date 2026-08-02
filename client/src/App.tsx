import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import RoleSelect from "./pages/RoleSelect";
import Night from "./pages/Night";
import Day from "./pages/Day";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:code" element={<Home />} />
        <Route path="/room/:roomCode" element={<Lobby />} />
        <Route path="/room/:roomCode/roles" element={<RoleSelect />} />
        <Route path="/room/:roomCode/night" element={<Night />} />
        <Route path="/room/:roomCode/day" element={<Day />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
