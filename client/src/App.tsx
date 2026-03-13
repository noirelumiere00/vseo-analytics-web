import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect, lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Loader2 } from "lucide-react";

// Lightweight pages - static import
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";

// Heavy pages - lazy import
const History = lazy(() => import("./pages/History"));
const AnalysisDetail = lazy(() => import("./pages/AnalysisDetail"));
const ReportView = lazy(() => import("./pages/ReportView"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLogs = lazy(() => import("./pages/AdminLogs").then(m => ({ default: m.AdminLogs })));
const Comparison = lazy(() => import("./pages/Comparison"));
const Trend = lazy(() => import("./pages/Trend"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Pricing = lazy(() => import("./pages/Pricing"));
const TrendDiscovery = lazy(() => import("./pages/TrendDiscovery"));
const TrendDiscoveryDetail = lazy(() => import("./pages/TrendDiscoveryDetail"));
const CampaignList = lazy(() => import("./pages/CampaignList"));
const CampaignNew = lazy(() => import("./pages/CampaignNew"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const CampaignReport = lazy(() => import("./pages/CampaignReport"));
const TrendInsights = lazy(() => import("./pages/TrendInsights"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
    <ScrollToTop />
    <Suspense fallback={<PageLoader />}>
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      {/* Protected routes */}
      <Route path={"/"} component={Home} />
      <Route path="/history" component={History} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/analysis/:id" component={AnalysisDetail} />
      <Route path="/compare" component={Comparison} />
      <Route path="/trend" component={Trend} />
      <Route path="/trend-discovery" component={TrendDiscovery} />
      <Route path="/trend-discovery/:id" component={TrendDiscoveryDetail} />
      <Route path="/trend-insights" component={TrendInsights} />
      <Route path="/campaigns" component={CampaignList} />
      <Route path="/campaigns/new" component={CampaignNew} />
      <Route path="/campaigns/:id" component={CampaignDetail} />
      <Route path="/campaigns/:id/report" component={CampaignReport} />
      <Route path="/report/view/:jobId" component={ReportView} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/logs" component={AdminLogs} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
