
import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';

const LandingPage = () => {
  const navigate = useNavigate();
  const [typewriterText, setTypewriterText] = useState('');
  const fullText = 'Ethical OSINT Platform';
  
  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index <= fullText.length) {
        setTypewriterText(fullText.slice(0, index));
        index++;
      } else {
        clearInterval(timer);
      }
    }, 100);
    
    return () => clearInterval(timer);
  }, []);

  const handleGetStarted = () => {
    navigate('/search');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 relative overflow-hidden">
      {/* Purple Grid Background */}
      <div className="absolute inset-0 opacity-30">
        <div 
          className="w-full h-full bg-repeat opacity-40"
          style={{
            backgroundImage: `
              linear-gradient(rgba(147, 51, 234, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(147, 51, 234, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      {/* Animated Background Nodes */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-20 w-2 h-2 bg-purple-400 rounded-full animate-pulse opacity-60"></div>
        <div className="absolute top-40 right-32 w-1 h-1 bg-purple-300 rounded-full animate-ping opacity-40"></div>
        <div className="absolute bottom-32 left-1/4 w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse opacity-50"></div>
        <div className="absolute top-60 left-1/2 w-1 h-1 bg-purple-400 rounded-full animate-ping opacity-30"></div>
        <div className="absolute bottom-20 right-20 w-2 h-2 bg-purple-300 rounded-full animate-pulse opacity-40"></div>
      </div>

      {/* Main Content */}
      <div className="min-h-screen flex items-center justify-center px-8">
        <div className="container mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
            
            {/* Left Side - Brain Animation */}
            <div className="flex flex-col items-center space-y-8">
              <div className="relative">
                <div className="w-96 h-96 bg-gradient-to-br from-purple-500/20 to-violet-600/20 rounded-full flex items-center justify-center border-2 border-purple-400/40 pulse-border-purple backdrop-blur-sm">
                  <div className="w-80 h-80 bg-purple-400/10 rounded-full flex items-center justify-center float backdrop-blur-sm">
                    <div className="text-9xl filter drop-shadow-lg">🧠</div>
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 w-8 h-8 bg-purple-400 rounded-full opacity-60 animate-ping"></div>
                <div className="absolute -bottom-4 -left-4 w-6 h-6 bg-violet-300 rounded-full opacity-40 animate-pulse"></div>
                <div className="absolute top-8 -left-8 w-4 h-4 bg-purple-300 rounded-full opacity-50 animate-ping"></div>
              </div>
              
              <Button 
                onClick={handleGetStarted}
                className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-400 hover:to-violet-500 text-white font-bold py-4 px-8 rounded-lg transition-all duration-300 transform hover:scale-105 hover:shadow-lg hover:shadow-purple-500/30 border border-purple-400/30 backdrop-blur-sm"
              >
                Get Started
              </Button>
            </div>

            {/* Right Side - Headlines */}
            <div className="space-y-8">
              <div className="space-y-6">
                <div className="bg-slate-800/40 backdrop-blur-sm border border-purple-400/20 rounded-lg p-6">
                  <h1 className="text-5xl lg:text-6xl font-bold leading-tight font-mono text-white">
                    {typewriterText}
                    <span className="animate-pulse text-purple-400 ml-1">|</span>
                  </h1>
                </div>
                
                <p className="text-xl text-purple-200/90 max-w-md leading-relaxed">
                  Advanced intelligence gathering with ethical boundaries and privacy protection at its core.
                </p>
              </div>

              <div className="space-y-4 bg-slate-800/30 backdrop-blur-sm border border-purple-400/20 rounded-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                  <span className="text-purple-200/80">Responsible Data Analysis</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                  <span className="text-purple-200/80">Privacy-First Approach</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                  <span className="text-purple-200/80">AI-Powered Insights</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
