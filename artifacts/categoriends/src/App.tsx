import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GameProvider } from "@/context/GameContext";
import { AuthProvider } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import SoloSetup from "@/pages/SoloSetup";
import CreateRoom from "@/pages/CreateRoom";
import JoinRoom from "@/pages/JoinRoom";
import RoomLobby from "@/pages/RoomLobby";
import GameScreen from "@/pages/GameScreen";
import Result from "@/pages/Result";
import DailyCategory from "@/pages/DailyCategory";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/en" component={Home} />
      <Route path="/tr" component={Home} />
      <Route path="/daily" component={DailyCategory} />
      <Route path="/en/daily" component={DailyCategory} />
      <Route path="/tr/daily" component={DailyCategory} />
      <Route path="/solo" component={SoloSetup} />
      <Route path="/room/create" component={CreateRoom} />
      <Route path="/room/join" component={JoinRoom} />
      <Route path="/room/:code" component={RoomLobby} />
      <Route path="/game" component={GameScreen} />
      <Route path="/result" component={Result} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <GameProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </GameProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
