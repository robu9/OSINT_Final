import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Search,
  ArrowLeft,
  FileText,
  User,
  Loader2,
  ShieldAlert,
  TrendingUp,
  BarChart,
  CalendarClock,
  Database,
  Globe,
  Lightbulb,
  Users,
  Building2,
  MapPin,
  ExternalLink,
  Download,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { API_BASE_URL } from "@/config";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

// --- Helper Functions for Dynamic Styling ---

const getRiskColor = (score: number) => {
  if (score >= 7) return "text-red-400";
  if (score >= 4) return "text-yellow-400";
  return "text-green-400";
};

const getRiskBg = (score: number) => {
  if (score >= 7) return "from-red-500/20 to-red-900/10 border-red-400/30";
  if (score >= 4) return "from-yellow-500/20 to-yellow-900/10 border-yellow-400/30";
  return "from-green-500/20 to-green-900/10 border-green-400/30";
};

const getRiskLabel = (score: number) => {
  if (score >= 8) return "Critical";
  if (score >= 6) return "High";
  if (score >= 4) return "Medium";
  if (score >= 2) return "Low";
  return "Minimal";
};

const getSentimentColor = (score: number) => {
  if (score > 0) return "text-green-400";
  if (score < 0) return "text-red-400";
  return "text-gray-400";
};

const getSentimentLabel = (score: number) => {
  if (score >= 3) return "Very Positive";
  if (score >= 1) return "Positive";
  if (score > -1) return "Neutral";
  if (score > -3) return "Negative";
  return "Very Negative";
};

const getSourceColor = (source: string) => {
  switch (source) {
    case "LinkedIn": return "bg-blue-500";
    case "Case/News": return "bg-amber-500";
    case "Reddit": return "bg-orange-500";
    case "Wikipedia": return "bg-gray-400";
    case "Business": return "bg-teal-500";
    case "Academic": return "bg-indigo-500";
    case "Social": return "bg-pink-500";
    default: return "bg-purple-500";
  }
};

const getSourceIcon = (source: string) => {
  switch (source) {
    case "LinkedIn": return "🔗";
    case "Case/News": return "📰";
    case "Reddit": return "💬";
    case "Wikipedia": return "📚";
    case "Business": return "🏢";
    case "Academic": return "🎓";
    case "Social": return "🐦";
    default: return "🌐";
  }
};

const SearchPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [formData, setFormData] = useState({ name: "", city: "", extraTerms: "" });
  const [isSearching, setIsSearching] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [personData, setPersonData] = useState<any>(null);
  const [currentQuote, setCurrentQuote] = useState(0);
  const [progress, setProgress] = useState({ percentage: 0, stage: "", status: "idle" });
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const osintQuotes = [
    "Information is the currency of the digital age.",
    "Uncovering the unseen, one data point at a time.",
    "Intelligence gathering with ethical boundaries.",
    "Knowledge is power, responsibility is wisdom.",
    "The art of finding needles in digital haystacks.",
    "Connecting the dots in a world of data.",
    "Every digital footprint tells a story.",
    "Aggregating signals from the noise.",
  ];

  useEffect(() => {
    let quoteInterval: any;
    if (isSearching) {
      quoteInterval = setInterval(() => {
        setCurrentQuote((prev) => (prev + 1) % osintQuotes.length);
      }, 2500);
    }
    return () => clearInterval(quoteInterval);
  }, [isSearching]);

  useEffect(() => {
    if (personData) {
      console.log("--- Full Backend Response ---", personData);
    }
  }, [personData]);

  // --- API Interaction Logic ---

  const pollProgress = (searchId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/progress/${searchId}`);
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);

        const progressData = await response.json();
        setProgress(progressData);

        if (progressData.status === "completed") {
          clearInterval(pollInterval);
          setIsSearching(false);
          setHasResults(true);
          setPersonData(progressData.result);
          toast({ title: "Search Completed", description: `Intelligence report ready for ${formData.name}` });
        } else if (progressData.status === "error") {
          clearInterval(pollInterval);
          setIsSearching(false);
          setProgress({ ...progressData, percentage: 0 });
          toast({ title: "Search Failed", description: progressData.error || "An unknown error occurred.", variant: "destructive" });
        }
      } catch (error) {
        clearInterval(pollInterval);
        setIsSearching(false);
        setProgress({ percentage: 0, stage: "Connection error", status: "error" });
        toast({ title: "Connection Error", description: "Unable to connect to the server.", variant: "destructive" });
      }
    }, 1000);
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setHasResults(false);
    setPersonData(null);
    setActiveTab("overview");
    setProgress({ percentage: 0, stage: "Initiating search...", status: "running" });

    try {
      const response = await fetch(`${API_BASE_URL}/osint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "An unknown server error occurred." }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.searchId) {
        pollProgress(data.searchId);
      } else {
        throw new Error("Did not receive a valid search ID from the server.");
      }
    } catch (error: any) {
      setIsSearching(false);
      setProgress({ percentage: 0, stage: "Search failed", status: "error" });
      toast({ title: "Search Failed", description: error.message, variant: "destructive" });
    }
  };

  const handleGenerateReport = async () => {
    if (!personData) return;
    try {
      const response = await fetch(`${API_BASE_URL}/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personData }),
      });
      const data = await response.json();
      if (data.filename) {
        // Trigger download
        const downloadUrl = `${API_BASE_URL}/download-report/${data.filename}`;
        window.open(downloadUrl, "_blank");
        toast({ title: "Report Generated", description: `Report saved as ${data.filename}` });
      } else {
        toast({ title: "Error", description: data.error || "Failed to generate report", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to generate report", variant: "destructive" });
    }
  };

  const startNewSearch = () => {
    setHasResults(false);
    setPersonData(null);
    setFormData({ name: "", city: "", extraTerms: "" });
    setActiveTab("overview");
  };

  // --- Data for Chart ---
  const chartData =
    personData?.sourceAnalysis
      ?.filter((s: any) => s.count > 0)
      ?.map((source: any) => ({
        subject: source.name,
        A: source.count,
        fullMark: Math.max(...personData.sourceAnalysis.map((s: any) => s.count), 0) + 5,
      })) || [];

  // --- Tab content for results ---
  const tabs = [
    { id: "overview", label: "Overview", icon: <User className="w-4 h-4" /> },
    { id: "findings", label: "Key Findings", icon: <Lightbulb className="w-4 h-4" /> },
    { id: "entities", label: "Entities", icon: <Users className="w-4 h-4" /> },
    { id: "timeline", label: "Timeline", icon: <CalendarClock className="w-4 h-4" /> },
    { id: "rawdata", label: "Raw Data", icon: <Database className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white relative overflow-hidden p-4 sm:p-8 font-sans">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `radial-gradient(circle at center, rgba(167, 139, 250, 0.3), transparent 60%), linear-gradient(rgba(147, 51, 234, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(147, 51, 234, 0.1) 1px, transparent 1px)`,
          backgroundSize: "100% 100%, 40px 40px, 40px 40px",
        }}
      />

      {!hasResults && (
        <div className="absolute top-6 left-6 z-20">
          <Button
            onClick={() => navigate("/")}
            className="bg-gray-900/60 backdrop-blur-sm border border-purple-400/30 hover:bg-gray-800/60 text-purple-200"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {/* --- SEARCH VIEW --- */}
          {!isSearching && !hasResults && (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-4xl"
            >
              <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30 p-12 shadow-2xl shadow-purple-500/10">
                <CardHeader className="text-center p-0 mb-8">
                  <h1 className="text-5xl font-bold text-purple-300">OSINT Intelligence Terminal</h1>
                  <p className="text-purple-200/70 text-xl mt-3">Enter target parameters to begin investigation</p>
                </CardHeader>
                <CardContent className="p-0 space-y-8">
                  <div>
                    <Label htmlFor="name" className="text-purple-200 mb-3 block text-lg">Full Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="bg-gray-800/60 border-purple-400/40 text-purple-100 focus:border-purple-400 p-4 text-xl"
                      placeholder="e.g., John Doe"
                    />
                  </div>
                  <div>
                    <Label htmlFor="city" className="text-purple-200 mb-3 block text-lg">City / Region</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="bg-gray-800/60 border-purple-400/40 text-purple-100 focus:border-purple-400 p-4 text-xl"
                      placeholder="e.g., New York"
                    />
                  </div>
                  <div>
                    <Label htmlFor="extraTerms" className="text-purple-200 mb-3 block text-lg">Additional Keywords</Label>
                    <Input
                      id="extraTerms"
                      value={formData.extraTerms}
                      onChange={(e) => setFormData({ ...formData, extraTerms: e.target.value })}
                      className="bg-gray-800/60 border-purple-400/40 text-purple-100 focus:border-purple-400 p-4 text-xl"
                      placeholder="e.g., CEO, TechCorp, lawsuit"
                    />
                  </div>
                  <Button
                    onClick={handleSearch}
                    disabled={!formData.name}
                    className="w-full !mt-10 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-400 hover:to-violet-500 text-white font-bold py-4 text-xl rounded-lg"
                  >
                    <Search className="w-6 h-6 mr-3" />
                    Initiate Search
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* --- LOADING VIEW --- */}
          {isSearching && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full max-w-2xl">
              <Card className="bg-gray-900/60 backdrop-blur-sm border border-purple-400/30 p-8 text-center">
                <motion.div key={currentQuote} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} className="text-purple-200 text-lg italic mb-4">
                  "{osintQuotes[currentQuote]}"
                </motion.div>
                <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
                <p className="text-purple-300/80 mb-6">Processing your request...</p>
                {progress.stage && (
                  <div className="space-y-3 text-left">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-purple-200">{progress.stage}</span>
                      <span className="text-purple-400 font-bold">{Math.round(progress.percentage)}%</span>
                    </div>
                    <div className="w-full bg-gray-800/60 rounded-full h-2.5">
                      <motion.div className="h-2.5 rounded-full bg-gradient-to-r from-purple-500 to-violet-600" animate={{ width: `${progress.percentage}%` }} />
                    </div>
                  </div>
                )}
              </Card>
            </motion.div>
          )}

          {/* --- RESULTS VIEW --- */}
          {hasResults && personData && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-7xl">
              {/* Top Bar */}
              <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-3">
                  <Button
                    onClick={startNewSearch}
                    className="bg-gray-800/60 border border-purple-400/30 hover:bg-gray-700/60 text-purple-200"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    New Search
                  </Button>
                  <div>
                    <h1 className="text-3xl font-bold text-purple-300 flex items-center gap-3">
                      <User className="w-7 h-7" />
                      {personData.name}
                    </h1>
                    <p className="text-purple-200/60 text-sm mt-1 flex items-center gap-2">
                      <MapPin className="w-3 h-3" />
                      {personData.location || "Location not specified"}
                      {personData.searchMeta && (
                        <span className="ml-3 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {personData.searchMeta.totalResultsFiltered} sources analyzed
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleGenerateReport}
                  className="bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-400 hover:to-teal-500 text-white font-bold"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Download Report
                </Button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-6 bg-gray-800/40 p-1 rounded-lg border border-purple-400/20 overflow-x-auto">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                      activeTab === tab.id
                        ? "bg-purple-500/30 text-purple-200 border border-purple-400/40"
                        : "text-purple-300/60 hover:text-purple-200 hover:bg-gray-700/40 border border-transparent"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <AnimatePresence mode="wait">
                {/* ───── OVERVIEW TAB ───── */}
                {activeTab === "overview" && (
                  <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Left column */}
                      <div className="lg:col-span-2 space-y-6">
                        {/* Risk + Sentiment Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Card className={`bg-gradient-to-br ${getRiskBg(personData.riskAnalysis?.riskScore)} p-5 border`}>
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-medium text-purple-200/80">Risk Assessment</span>
                              <ShieldAlert className="w-5 h-5 text-purple-400" />
                            </div>
                            <div className="flex items-end gap-3 mb-2">
                              <p className={`text-5xl font-bold ${getRiskColor(personData.riskAnalysis?.riskScore)}`}>
                                {personData.riskAnalysis?.riskScore}<span className="text-2xl">/10</span>
                              </p>
                              <span className={`text-sm font-semibold mb-1 ${getRiskColor(personData.riskAnalysis?.riskScore)}`}>
                                {getRiskLabel(personData.riskAnalysis?.riskScore)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed">{personData.riskAnalysis?.riskJustification}</p>
                          </Card>

                          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-900/10 p-5 border border-purple-400/20">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-medium text-purple-200/80">Public Sentiment</span>
                              <TrendingUp className="w-5 h-5 text-purple-400" />
                            </div>
                            <div className="flex items-end gap-3 mb-2">
                              <p className={`text-5xl font-bold ${getSentimentColor(personData.riskAnalysis?.sentimentScore)}`}>
                                {personData.riskAnalysis?.sentimentScore > 0 ? "+" : ""}{personData.riskAnalysis?.sentimentScore}
                              </p>
                              <span className={`text-sm font-semibold mb-1 ${getSentimentColor(personData.riskAnalysis?.sentimentScore)}`}>
                                {getSentimentLabel(personData.riskAnalysis?.sentimentScore)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed">{personData.riskAnalysis?.sentimentJustification}</p>
                          </Card>
                        </div>

                        {/* AI Summary */}
                        <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                          <CardHeader className="pb-3">
                            <CardTitle className="flex items-center text-lg text-purple-300">
                              <Info className="w-5 h-5 mr-2" />
                              AI Intelligence Summary
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="text-purple-100/90 leading-relaxed bg-black/20 p-4 rounded-md border border-purple-400/20">
                              <p><strong>Executive Summary:</strong> {personData.short_summary}</p>
                              <AnimatePresence>
                                {isSummaryExpanded && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                    animate={{ opacity: 1, height: "auto", marginTop: "16px" }}
                                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                    transition={{ duration: 0.4, ease: "easeInOut" }}
                                  >
                                    <p className="whitespace-pre-line"><strong>Detailed Analysis:</strong> {personData.detailed_summary}</p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            <Button variant="link" onClick={() => setIsSummaryExpanded(!isSummaryExpanded)} className="text-purple-300 p-0 h-auto">
                              {isSummaryExpanded ? "Show Less" : "Show Detailed Analysis →"}
                            </Button>
                          </CardContent>
                        </Card>

                        {/* Social Profiles */}
                        {personData.profileInfo?.socialProfiles?.length > 0 && (
                          <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                            <CardHeader className="pb-3">
                              <CardTitle className="flex items-center text-lg text-purple-300">
                                <Globe className="w-5 h-5 mr-2" />
                                Social Profiles Found
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-3">
                                {personData.profileInfo.socialProfiles.map((profile: any, i: number) => (
                                  <a
                                    key={i}
                                    href={profile.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-4 py-2 bg-black/20 rounded-lg border border-purple-400/20 hover:border-purple-400/50 transition-colors"
                                  >
                                    <ExternalLink className="w-3 h-3 text-purple-400" />
                                    <span className="text-purple-200 text-sm font-medium">{profile.platform}</span>
                                  </a>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>

                      {/* Right column */}
                      <div className="space-y-6">
                        {/* Source Radar */}
                        <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                          <CardHeader className="pb-2">
                            <CardTitle className="flex items-center text-lg text-purple-300">
                              <BarChart className="w-5 h-5 mr-2" />
                              Source Analysis
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {chartData.length > 0 ? (
                              <ResponsiveContainer width="100%" height={250}>
                                <RadarChart cx="50%" cy="50%" outerRadius="65%" data={chartData} margin={{ top: 10, right: 25, bottom: 10, left: 25 }}>
                                  <PolarGrid stroke="rgba(167, 139, 250, 0.2)" />
                                  <PolarAngleAxis dataKey="subject" stroke="rgba(224, 204, 255, 0.7)" tickLine={false} tick={{ fontSize: 11 }} />
                                  <PolarRadiusAxis angle={30} domain={[0, "dataMax + 3"]} tick={false} axisLine={false} />
                                  <Radar name="Findings" dataKey="A" stroke="#a78bfa" fill="#8b5cf6" fillOpacity={0.6} />
                                  <Tooltip contentStyle={{ backgroundColor: "rgba(30, 30, 40, 0.95)", borderColor: "rgba(136, 132, 216, 0.5)", borderRadius: "8px", fontSize: "12px" }} />
                                </RadarChart>
                              </ResponsiveContainer>
                            ) : (
                              <p className="text-purple-200/50 text-center py-8 text-sm">No source data</p>
                            )}
                            {/* Source legend */}
                            <div className="mt-2 space-y-1">
                              {personData.sourceAnalysis?.filter((s: any) => s.count > 0).map((source: any, i: number) => (
                                <div key={i} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2.5 h-2.5 rounded-full ${getSourceColor(source.name)}`} />
                                    <span className="text-purple-200/80">{getSourceIcon(source.name)} {source.name}</span>
                                  </div>
                                  <span className="text-purple-300 font-medium">{source.count}</span>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>

                        {/* Search Stats */}
                        {personData.searchMeta && (
                          <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-purple-300">Search Statistics</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-xs">
                              <div className="flex justify-between">
                                <span className="text-purple-200/60">Results scanned</span>
                                <span className="text-purple-200 font-medium">{personData.searchMeta.totalResultsScanned}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-200/60">Relevant matches</span>
                                <span className="text-purple-200 font-medium">{personData.searchMeta.totalResultsFiltered}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-200/60">Sources queried</span>
                                <span className="text-purple-200 font-medium">{personData.searchMeta.sourcesQueried}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-purple-200/60">Timestamp</span>
                                <span className="text-purple-200 font-medium">
                                  {new Date(personData.searchMeta.searchTimestamp).toLocaleTimeString()}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Known Titles / Orgs */}
                        {(personData.profileInfo?.knownTitles?.length > 0 || personData.profileInfo?.knownOrganizations?.length > 0) && (
                          <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm text-purple-300">Profile Metadata</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {personData.profileInfo?.knownTitles?.length > 0 && (
                                <div>
                                  <p className="text-xs text-purple-200/50 mb-1">Known Titles</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {personData.profileInfo.knownTitles.slice(0, 5).map((title: string, i: number) => (
                                      <span key={i} className="text-xs px-2 py-1 bg-purple-500/15 border border-purple-400/20 rounded text-purple-200">{title}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {personData.profileInfo?.knownOrganizations?.length > 0 && (
                                <div>
                                  <p className="text-xs text-purple-200/50 mb-1">Organizations</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {personData.profileInfo.knownOrganizations.slice(0, 5).map((org: string, i: number) => (
                                      <span key={i} className="text-xs px-2 py-1 bg-teal-500/15 border border-teal-400/20 rounded text-teal-200">{org}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ───── KEY FINDINGS TAB ───── */}
                {activeTab === "findings" && (
                  <motion.div key="findings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Key Findings */}
                      <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                        <CardHeader>
                          <CardTitle className="flex items-center text-xl text-purple-300">
                            <Lightbulb className="w-5 h-5 mr-2" />
                            Key Findings
                          </CardTitle>
                          <CardDescription className="text-purple-200/60">AI-extracted insights from the data</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {personData.keyFindings?.length > 0 ? (
                            <div className="space-y-3">
                              {personData.keyFindings.map((finding: string, i: number) => (
                                <div key={i} className="flex items-start gap-3 p-3 bg-black/20 rounded-lg border border-purple-400/10">
                                  <CheckCircle2 className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
                                  <p className="text-purple-100/90 text-sm">{finding}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-purple-200/50 text-center py-8">No key findings extracted.</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Associated Entities from AI */}
                      <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                        <CardHeader>
                          <CardTitle className="flex items-center text-xl text-purple-300">
                            <Users className="w-5 h-5 mr-2" />
                            Associated Entities
                          </CardTitle>
                          <CardDescription className="text-purple-200/60">People, orgs, and places connected to the target</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {personData.associatedEntities?.length > 0 ? (
                            <div className="space-y-3">
                              {personData.associatedEntities.map((entity: any, i: number) => (
                                <div key={i} className="p-3 bg-black/20 rounded-lg border border-purple-400/10">
                                  <div className="flex items-center gap-2 mb-1">
                                    {entity.type === "person" && <User className="w-3.5 h-3.5 text-blue-400" />}
                                    {entity.type === "organization" && <Building2 className="w-3.5 h-3.5 text-teal-400" />}
                                    {entity.type === "location" && <MapPin className="w-3.5 h-3.5 text-amber-400" />}
                                    <span className="text-purple-200 font-medium text-sm">{entity.name}</span>
                                    <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 rounded text-purple-300">{entity.type}</span>
                                  </div>
                                  <p className="text-xs text-purple-200/60 ml-5">{entity.relationship}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-purple-200/50 text-center py-8">No associated entities identified.</p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </motion.div>
                )}

                {/* ───── ENTITIES TAB ───── */}
                {activeTab === "entities" && (
                  <motion.div key="entities" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Related Persons */}
                      <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                        <CardHeader>
                          <CardTitle className="flex items-center text-lg text-purple-300">
                            <Users className="w-5 h-5 mr-2" />
                            Related People
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {personData.entityAnalysis?.relatedPersons?.length > 0 ? (
                            <div className="space-y-2">
                              {personData.entityAnalysis.relatedPersons.map((p: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-2 bg-black/20 rounded border border-purple-400/10">
                                  <span className="text-purple-200 text-sm">{p.name}</span>
                                  <span className="text-xs px-2 py-0.5 bg-blue-500/20 rounded-full text-blue-300">{p.mentions} mentions</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-purple-200/50 text-center py-6 text-sm">No related people found</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Related Organizations */}
                      <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                        <CardHeader>
                          <CardTitle className="flex items-center text-lg text-purple-300">
                            <Building2 className="w-5 h-5 mr-2" />
                            Organizations
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {personData.entityAnalysis?.relatedOrganizations?.length > 0 ? (
                            <div className="space-y-2">
                              {personData.entityAnalysis.relatedOrganizations.map((o: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-2 bg-black/20 rounded border border-purple-400/10">
                                  <span className="text-purple-200 text-sm">{o.name}</span>
                                  <span className="text-xs px-2 py-0.5 bg-teal-500/20 rounded-full text-teal-300">{o.mentions} mentions</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-purple-200/50 text-center py-6 text-sm">No organizations found</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Related Locations */}
                      <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                        <CardHeader>
                          <CardTitle className="flex items-center text-lg text-purple-300">
                            <MapPin className="w-5 h-5 mr-2" />
                            Locations
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {personData.entityAnalysis?.relatedLocations?.length > 0 ? (
                            <div className="space-y-2">
                              {personData.entityAnalysis.relatedLocations.map((l: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-2 bg-black/20 rounded border border-purple-400/10">
                                  <span className="text-purple-200 text-sm">{l.name}</span>
                                  <span className="text-xs px-2 py-0.5 bg-amber-500/20 rounded-full text-amber-300">{l.mentions} mentions</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-purple-200/50 text-center py-6 text-sm">No locations found</p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </motion.div>
                )}

                {/* ───── TIMELINE TAB ───── */}
                {activeTab === "timeline" && (
                  <motion.div key="timeline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                      <CardHeader>
                        <CardTitle className="flex items-center text-2xl text-purple-300">
                          <CalendarClock className="w-6 h-6 mr-3" />
                          Evidence Timeline
                        </CardTitle>
                        <CardDescription className="text-purple-200/60">Chronological events extracted from data sources</CardDescription>
                      </CardHeader>
                      <CardContent className="relative pl-6">
                        {personData.timelineEvents?.length > 0 ? (
                          <>
                            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-purple-400/30" />
                            <div className="space-y-6">
                              {personData.timelineEvents.map((event: any, index: number) => (
                                <motion.div
                                  key={index}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  className="relative flex items-start"
                                >
                                  <div className="absolute left-0 top-1.5 flex items-center justify-center w-5 h-5 bg-gray-800 rounded-full border-2 border-purple-400">
                                    <div className={`w-2 h-2 rounded-full ${getSourceColor(event.source)}`} />
                                  </div>
                                  <div className="ml-12">
                                    <p className="font-bold text-purple-200">{event.date}</p>
                                    <p className="text-purple-100/90">{event.title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className={`text-xs font-semibold px-2 py-0.5 inline-block rounded-full text-white ${getSourceColor(event.source)}`}>
                                        {event.source}
                                      </span>
                                      {event.link && (
                                        <a href={event.link} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:underline flex items-center gap-1">
                                          <ExternalLink className="w-3 h-3" /> View source
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </motion.div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-16 text-center">
                            <CalendarClock className="w-12 h-12 text-purple-400/30 mb-4" />
                            <p className="text-purple-200/70">No chronological events could be extracted from the data sources.</p>
                            <p className="text-purple-200/40 text-sm mt-1">This is common for persons with limited dated online coverage.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {/* ───── RAW DATA TAB ───── */}
                {activeTab === "rawdata" && (
                  <motion.div key="rawdata" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className="bg-gray-900/70 backdrop-blur-md border border-purple-400/30">
                      <CardHeader>
                        <CardTitle className="flex items-center text-2xl text-purple-300">
                          <Database className="w-6 h-6 mr-3" />
                          Raw Intelligence Data
                        </CardTitle>
                        <CardDescription className="text-purple-200/60">
                          All {personData.raw_data?.length || 0} data points gathered for this investigation
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {personData.raw_data?.length > 0 ? (
                          personData.raw_data.map((item: any, index: number) => (
                            <motion.div
                              key={index}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: index * 0.05 }}
                              className="p-4 bg-black/20 rounded-lg border border-purple-400/20 hover:border-purple-400/40 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <h3 className="font-bold text-purple-200 text-sm">{item.title}</h3>
                                  <p className="text-sm text-purple-100/70 mt-1">{item.snippet}</p>
                                  {item.displayLink && (
                                    <p className="text-xs text-purple-300/40 mt-1">{item.displayLink}</p>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${getSourceColor(item.source)}`}>
                                    {item.source}
                                  </span>
                                  {item.matchMethod && (
                                    <span className="text-xs px-1.5 py-0.5 bg-gray-700/60 rounded text-purple-300/60">
                                      {item.matchMethod}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="mt-2">
                                <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:underline flex items-center gap-1">
                                  <ExternalLink className="w-3 h-3" /> View source
                                </a>
                              </div>
                            </motion.div>
                          ))
                        ) : (
                          <p className="text-purple-200/70 text-center py-12">No raw data available.</p>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default SearchPage;
