/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect, useCallback, Component } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { 
  Layout, 
  Newspaper, 
  Instagram, 
  Image as ImageIcon, 
  Loader2, 
  Sparkles,
  ArrowRight,
  Maximize2,
  Facebook,
  Twitter,
  Linkedin,
  X,
  Filter,
  Brain,
  LogOut,
  History,
  User as UserIcon,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  setDoc, 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  User,
  doc,
  deleteDoc
} from './firebase';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type Medium = 'billboard' | 'newspaper' | 'social';
type VisualStyle = 'minimalist' | 'cyberpunk' | 'vintage' | 'luxury' | 'brutalist';
type FilterType = 'none' | 'grayscale' | 'sepia' | 'warm' | 'cool' | 'vignette';

interface BrandGuidelines {
  colors: string[];
  fonts: string;
  tone: string;
}

interface GeneratedImage {
  url: string;
  medium: Medium;
  prompt: string;
  copy: string;
}

interface CampaignRecord {
  id: string;
  userId: string;
  description: string;
  style: VisualStyle;
  guidelines: BrandGuidelines;
  referenceImage: string;
  results: GeneratedImage[];
  createdAt: any;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

// Error Boundary Component
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    const { hasError } = this.state;
    if (hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-studio-bg p-8 studio-grid">
          <div className="max-w-md w-full relative z-10 brand-card p-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-serif italic mb-4">Something went wrong</h2>
            <p className="text-sm opacity-50 mb-12 leading-relaxed font-light">
              We encountered an unexpected error. Please try refreshing the page.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full btn-primary"
            >
              Refresh App
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrandBuilderApp />
    </ErrorBoundary>
  );
}

function BrandBuilderApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [description, setDescription] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<VisualStyle>('minimalist');
  const [isGeneratingRef, setIsGeneratingRef] = useState(false);
  const [isGeneratingCampaign, setIsGeneratingCampaign] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [guidelines, setGuidelines] = useState<BrandGuidelines>({
    colors: ['#1A1A1A', '#5A5A40', '#F5F5F0'],
    fonts: 'Inter & Cormorant Garamond',
    tone: 'Sophisticated and minimalist.'
  });
  const [draftedCopy, setDraftedCopy] = useState<{ [key in Medium]: string } | null>(null);
  const [isGuidelinesOpen, setIsGuidelinesOpen] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>('none');
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [history, setHistory] = useState<CampaignRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<CampaignRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser) {
        // Sync user to Firestore
        setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email,
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          createdAt: serverTimestamp()
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  // History Listener
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'campaigns'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: CampaignRecord[] = [];
      snapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() } as CampaignRecord);
      });
      setHistory(records);
    }, (err) => {
      console.error("Firestore History Error:", err);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login Error:", err);
      setError("Failed to sign in with Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResults([]);
      setReferenceImage(null);
      setDescription('');
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  const saveCampaign = async (campaignData: Omit<CampaignRecord, 'id' | 'createdAt'>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'campaigns'), {
        ...campaignData,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Save Campaign Error:", err);
    }
  };

  const loadCampaign = (campaign: CampaignRecord) => {
    setDescription(campaign.description);
    setSelectedStyle(campaign.style);
    setGuidelines(campaign.guidelines);
    setReferenceImage(campaign.referenceImage);
    setResults(campaign.results);
    setShowHistory(false);
  };

  const deleteCampaign = async (campaignId: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'campaigns', campaignId));
      setCampaignToDelete(null);
    } catch (err) {
      console.error("Delete Campaign Error:", err);
      setError("Failed to delete campaign.");
    } finally {
      setIsDeleting(false);
    }
  };

  const styles: { id: VisualStyle; label: string; icon: React.ReactNode }[] = [
    { id: 'minimalist', label: 'Minimalist', icon: <div className="w-3 h-3 border border-current rounded-sm" /> },
    { id: 'luxury', label: 'Luxury', icon: <div className="w-3 h-3 bg-current rounded-full" /> },
    { id: 'vintage', label: 'Vintage', icon: <div className="w-3 h-3 border-b-2 border-current" /> },
    { id: 'cyberpunk', label: 'Cyberpunk', icon: <div className="w-3 h-3 bg-current rotate-45" /> },
    { id: 'brutalist', label: 'Brutalist', icon: <div className="w-3 h-3 border-2 border-current" /> },
  ];

  const updateGuideline = (key: keyof BrandGuidelines, value: any) => {
    setGuidelines(prev => ({ ...prev, [key]: value }));
  };

  const updateColor = (index: number, color: string) => {
    const newColors = [...guidelines.colors];
    newColors[index] = color;
    updateGuideline('colors', newColors);
  };

  const filters: { id: FilterType; label: string }[] = [
    { id: 'none', label: 'Original' },
    { id: 'grayscale', label: 'B&W' },
    { id: 'sepia', label: 'Sepia' },
    { id: 'warm', label: 'Warm' },
    { id: 'cool', label: 'Cool' },
    { id: 'vignette', label: 'Vignette' },
  ];

  const getFilterStyle = (filter: FilterType) => {
    switch (filter) {
      case 'grayscale': return 'grayscale(100%)';
      case 'sepia': return 'sepia(100%)';
      case 'warm': return 'sepia(30%) saturate(140%) brightness(105%)';
      case 'cool': return 'hue-rotate(180deg) saturate(80%) brightness(105%)';
      default: return 'none';
    }
  };

  const generateReference = async () => {
    if (!description.trim()) return;
    
    setIsGeneratingRef(true);
    setError(null);
    setReferenceImage(null);

    try {
      // Step 1: Generate Brand Guidelines and Copy using Gemini Text
      const textResponse = await ai.models.generateContent({
        model: isThinkingMode ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview',
        contents: `Based on this product description: "${description}" and the visual style: "${selectedStyle}", generate:
        1. Brand Guidelines: 3 hex colors, recommended font pairing, and 1 sentence tone of voice.
        2. Ad Copy for 3 mediums: 
           - Billboard: A short, punchy headline (max 5 words).
           - Newspaper: A formal, persuasive body paragraph (2-3 sentences).
           - Social: A trendy, engaging caption with 2 hashtags.
        Return as JSON.`,
        config: {
          responseMimeType: 'application/json',
          thinkingConfig: isThinkingMode ? { thinkingLevel: ThinkingLevel.HIGH } : undefined,
          responseSchema: {
            type: 'object',
            properties: {
              guidelines: {
                type: 'object',
                properties: {
                  colors: { type: 'array', items: { type: 'string' } },
                  fonts: { type: 'string' },
                  tone: { type: 'string' }
                },
                required: ['colors', 'fonts', 'tone']
              },
              copy: {
                type: 'object',
                properties: {
                  billboard: { type: 'string' },
                  newspaper: { type: 'string' },
                  social: { type: 'string' }
                },
                required: ['billboard', 'newspaper', 'social']
              }
            },
            required: ['guidelines', 'copy']
          }
        }
      });

      const data = JSON.parse(textResponse.text || '{}');
      setGuidelines(data.guidelines);
      setIsGuidelinesOpen(true);

      // Step 2: Generate a reference product image for consistency
      const refResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A professional, high-quality studio product shot of ${description}. Style: ${selectedStyle}. Colors: ${data.guidelines.colors.join(', ')}. Plain white background, soft lighting, no people, centered, sharp focus.` }]
        },
        config: {
          imageConfig: { aspectRatio: "1:1" }
        }
      });

      let refImgBase64 = '';
      for (const part of refResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          refImgBase64 = part.inlineData.data;
          break;
        }
      }

      if (!refImgBase64) throw new Error("Failed to generate reference image");
      
      const refUrl = `data:image/png;base64,${refImgBase64}`;
      setReferenceImage(refUrl);
    } catch (err) {
      console.error(err);
      setError("Failed to generate reference concept. Please try again.");
    } finally {
      setIsGeneratingRef(false);
    }
  };

  const generateCampaign = async () => {
    if (!description.trim() || !referenceImage) return;
    
    setIsGeneratingCampaign(true);
    setError(null);
    setResults([]);

    try {
      // We need the guidelines/copy data again or we should store the copy in state
      // For simplicity, we'll re-generate or assume it's in the guidelines/copy state if we added it
      // Let's add a copy state to store the drafted copy
      
      const refImgBase64 = referenceImage.split(',')[1];

      const mediums: Medium[] = ['billboard', 'newspaper', 'social'];
      const generatedResults: GeneratedImage[] = [];

      for (const medium of mediums) {
        let mediumPrompt = '';
        let aspectRatio: "1:1" | "16:9" | "9:16" | "3:4" | "4:3" = "1:1";

        switch (medium) {
          case 'billboard':
            mediumPrompt = `A massive outdoor city billboard featuring this product. Style: ${selectedStyle}. Colors: ${guidelines.colors.join(', ')}. Urban environment, daytime, professional advertising photography, no people. Maintain the exact look of the product from the reference image.`;
            aspectRatio = "16:9";
            break;
          case 'newspaper':
            mediumPrompt = `A classic black and white newspaper advertisement. Style: ${selectedStyle}. The product is the centerpiece. Clear, elegant layout with sophisticated typography and borders. Visible vintage newsprint grain and halftone texture. High contrast, no people. Maintain the exact product design from the reference image.`;
            aspectRatio = "3:4";
            break;
          case 'social':
            mediumPrompt = `A high-end lifestyle product shot for social media. Style: ${selectedStyle}. Colors: ${guidelines.colors.join(', ')}. Minimalist aesthetic background, trendy lighting, professional marketing style, no people. Maintain the exact look of the product from the reference image.`;
            aspectRatio = "1:1";
            break;
        }

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              {
                inlineData: {
                  data: refImgBase64,
                  mimeType: "image/png"
                }
              },
              { text: mediumPrompt }
            ]
          },
          config: {
            imageConfig: { aspectRatio }
          }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            generatedResults.push({
              url: `data:image/png;base64,${part.inlineData.data}`,
              medium,
              prompt: mediumPrompt,
              copy: draftedCopy ? draftedCopy[medium] : ''
            });
            break;
          }
        }
      }

      setResults(generatedResults);

      // Save to Firestore
      if (user) {
        saveCampaign({
          description,
          style: selectedStyle,
          guidelines,
          referenceImage: referenceImage!,
          results: generatedResults,
          userId: user.uid
        });
      }
    } catch (err: any) {
      console.error(err);
      const errorMessage = err?.message || "Failed to generate campaign. Please try again.";
      setError(errorMessage);
    } finally {
      setIsGeneratingCampaign(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-studio-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white opacity-20" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-studio-bg text-studio-ink font-sans flex items-center justify-center p-8 studio-grid">
        <div className="max-w-md w-full relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="brand-card p-12 text-center"
          >
            <div className="w-20 h-20 bg-studio-ink rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl">
              <Sparkles className="text-black w-10 h-10" />
            </div>
            <h1 className="text-4xl font-serif mb-4 italic">Brand Builder</h1>
            <p className="text-sm opacity-50 mb-12 leading-relaxed font-light">
              Visualize your brand's future with AI-powered creative direction.
            </p>
            <button 
              onClick={handleLogin}
              className="w-full btn-primary flex items-center justify-center gap-3"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              Sign in with Google
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-studio-bg text-studio-ink font-sans selection:bg-white selection:text-black studio-grid overflow-x-hidden">
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/5 py-6 md:py-8 px-6 md:px-12 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-studio-ink rounded-full flex items-center justify-center">
            <Sparkles className="text-black w-4 h-4 md:w-5 md:h-5" />
          </div>
          <h1 className="text-xl md:text-2xl font-serif italic tracking-tight">Brand Builder</h1>
        </div>
        
        <div className="flex items-center gap-4 md:gap-8">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] opacity-40 font-bold hover:opacity-100 transition-opacity flex items-center gap-2"
          >
            <History className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden xs:inline">Archives</span>
          </button>
          <div className="h-4 w-[1px] bg-white/10 hidden xs:block" />
          <div className="flex items-center gap-3 md:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em]">{user.displayName}</p>
              <button 
                onClick={handleLogout}
                className="text-[8px] md:text-[9px] uppercase tracking-[0.2em] opacity-30 hover:opacity-100 transition-opacity flex items-center gap-1 ml-auto"
              >
                <LogOut className="w-2.5 h-2.5 md:w-3 md:h-3" />
                Logout
              </button>
            </div>
            {user.photoURL ? (
              <img src={user.photoURL} alt="User" className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-white/10 grayscale hover:grayscale-0 transition-all" />
            ) : (
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/5 flex items-center justify-center">
                <UserIcon className="w-4 h-4 md:w-5 md:h-5 opacity-30" />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-12 py-12 md:py-20">
        {/* History Modal */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-12 bg-studio-bg/95 backdrop-blur-xl"
              onClick={() => setShowHistory(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative max-w-5xl w-full bg-studio-paper rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] border border-studio-ink/5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-10 border-b border-white/5 flex justify-between items-center">
                  <h3 className="text-3xl font-serif italic">Archives</h3>
                  <button onClick={() => setShowHistory(false)} className="p-3 hover:bg-white/5 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-10">
                  {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-10">
                      <History className="w-16 h-16 mb-6" />
                      <p className="uppercase tracking-[0.3em] text-[10px] font-bold">No records found</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                      {history.map((record) => (
                        <div 
                          key={record.id}
                          className="group brand-card p-6 cursor-pointer relative"
                          onClick={() => loadCampaign(record)}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCampaignToDelete(record);
                            }}
                            className="absolute top-4 right-4 p-2 bg-black/80 backdrop-blur-sm text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white z-10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-6 bg-white/5">
                            <img src={record.referenceImage} className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700" alt="Ref" />
                          </div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-30 mb-3">
                            {record.createdAt?.toDate ? record.createdAt.toDate().toLocaleDateString() : 'Recent'}
                          </p>
                          <h4 className="text-xl font-serif italic line-clamp-1 mb-3">{record.description}</h4>
                          <div className="flex gap-2">
                            <span className="text-[8px] uppercase tracking-[0.2em] font-bold px-2 py-1 bg-white/5 rounded-md opacity-40">
                              {record.style}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {campaignToDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-studio-ink/20 backdrop-blur-sm"
              onClick={() => setCampaignToDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-studio-paper p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center border border-studio-ink/5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-serif italic mb-2">Remove Record?</h3>
                <p className="text-[11px] opacity-50 mb-8 leading-relaxed uppercase tracking-widest font-bold">
                  This action is permanent and cannot be undone.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setCampaignToDelete(null)}
                    className="flex-1 btn-secondary !py-3 !px-4"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteCampaign(campaignToDelete.id)}
                    disabled={isDeleting}
                    className="flex-1 bg-red-600 text-white py-3 rounded-full font-bold tracking-widest uppercase text-[9px] hover:bg-red-700 transition-all disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Section */}
        <section className="mb-32">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-4 mb-8">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-30">01</span>
                <h2 className="text-4xl font-serif italic">The Brief</h2>
              </div>
              <div className="brand-card p-6 md:p-10 bg-studio-paper">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your creative vision..."
                  className="input-brief text-xl md:text-2xl"
                  rows={4}
                />
                
                {/* Style Toggles */}
                <div className="flex flex-wrap gap-4 mt-8">
                  {styles.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      className={`px-6 py-3 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] transition-all border flex items-center gap-2 ${
                        selectedStyle === style.id 
                          ? 'bg-white text-black border-white shadow-lg scale-105' 
                          : 'bg-white/5 text-white/40 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {style.icon}
                      {style.label}
                    </button>
                  ))}
                </div>

                {/* Filter Toggles */}
                <div className="flex flex-wrap gap-3 mt-8">
                  <div className="flex items-center gap-2 mr-2 opacity-40">
                    <Filter className="w-3 h-3" />
                    <span className="text-[9px] uppercase font-bold tracking-[0.2em]">Filters</span>
                  </div>
                  {filters.map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setActiveFilter(filter.id)}
                      className={`px-4 py-2 rounded-lg text-[9px] font-bold tracking-[0.2em] uppercase transition-all ${
                        activeFilter === filter.id 
                          ? 'bg-white text-black' 
                          : 'bg-white/5 text-white/40 hover:bg-white/10'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                
                <div className="mt-12 flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={() => setIsThinkingMode(!isThinkingMode)}
                    className={`flex items-center justify-center gap-3 px-6 py-4 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase transition-all border ${
                      isThinkingMode 
                        ? 'bg-white text-black border-white shadow-md' 
                        : 'bg-white/5 text-white/40 border-white/10 hover:border-white/30'
                    }`}
                  >
                    <Brain className={`w-4 h-4 ${isThinkingMode ? 'animate-pulse' : ''}`} />
                    Thinking Mode
                  </button>

                  <button
                    onClick={generateReference}
                    disabled={isGeneratingRef || isGeneratingCampaign || !description.trim()}
                    className="flex-1 btn-primary flex items-center justify-center gap-3"
                  >
                    {isGeneratingRef ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Drafting...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Generate Reference
                      </>
                    )}
                  </button>

                  {referenceImage && (
                    <button
                      onClick={generateCampaign}
                      disabled={isGeneratingRef || isGeneratingCampaign || !description.trim()}
                      className="flex-1 btn-primary bg-studio-accent flex items-center justify-center gap-3"
                    >
                      {isGeneratingCampaign ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Launching...
                        </>
                      ) : (
                        <>
                          Launch Campaign
                          <ArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Brand Guidelines Section (Editable & Collapsible) */}
        <section className="mb-32">
          <div className="brand-card overflow-hidden">
            <button 
              onClick={() => setIsGuidelinesOpen(!isGuidelinesOpen)}
              className="w-full p-10 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4 opacity-40 uppercase tracking-[0.3em] text-[10px] font-bold">
                <div className="w-6 h-[1px] bg-current" />
                Brand Identity Guidelines
              </div>
              <motion.div
                animate={{ rotate: isGuidelinesOpen ? 180 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <ArrowRight className="w-5 h-5 rotate-90 opacity-30" />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {isGuidelinesOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                >
                  <div className="px-6 md:px-10 pb-12 md:pb-16 grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16 border-t border-white/5 pt-12">
                    {/* Colors */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-6 opacity-50">Color Palette</h4>
                      <div className="flex gap-4">
                        {guidelines.colors.map((color, idx) => (
                          <div key={`color-input-${idx}`} className="flex flex-col gap-3">
                            <div 
                              className="w-14 h-14 rounded-2xl border border-white/10 shadow-inner relative overflow-hidden" 
                              style={{ backgroundColor: color }}
                            >
                              <input 
                                type="color" 
                                value={color}
                                onChange={(e) => updateColor(idx, e.target.value)}
                                className="absolute inset-0 opacity-0 cursor-pointer scale-150"
                              />
                            </div>
                            <input 
                              type="text"
                              value={color}
                              onChange={(e) => updateColor(idx, e.target.value)}
                              className="text-[9px] font-mono w-14 bg-transparent border-none focus:outline-none opacity-40 hover:opacity-100 transition-opacity text-center"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Fonts */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-6 opacity-50">Typography</h4>
                      <input 
                        type="text"
                        value={guidelines.fonts}
                        onChange={(e) => updateGuideline('fonts', e.target.value)}
                        placeholder="e.g., Playfair Display, Inter"
                        className="w-full bg-transparent border-b border-white/10 py-2 text-xl font-serif italic focus:outline-none focus:border-white transition-colors"
                      />
                    </div>

                    {/* Tone */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-6 opacity-50">Tone of Voice</h4>
                      <textarea 
                        value={guidelines.tone}
                        onChange={(e) => updateGuideline('tone', e.target.value)}
                        placeholder="e.g., Sophisticated and minimalist."
                        className="w-full bg-transparent border-b border-white/10 py-2 text-sm leading-relaxed opacity-70 focus:outline-none focus:border-white transition-colors resize-none h-24"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Error State */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm"
          >
            {error}
          </motion.div>
        )}

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-12">
          <AnimatePresence mode="popLayout">
            {isGeneratingCampaign && !results.length && (
              [1, 2, 3].map((i) => (
                <motion.div
                  key={`skeleton-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="aspect-square brand-card flex flex-col items-center justify-center gap-6 animate-pulse"
                >
                  <div className="w-16 h-16 bg-studio-ink/5 rounded-full" />
                  <div className="h-2 w-32 bg-studio-ink/5 rounded-full" />
                </motion.div>
              ))
            )}

            {results.map((result, idx) => (
              <motion.div
                key={result.medium}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="group"
              >
                <div className="brand-card overflow-hidden">
                  <div 
                    className={`aspect-square relative overflow-hidden bg-studio-bg cursor-zoom-in group/image ${result.medium === 'newspaper' ? 'grayscale contrast-125 brightness-95' : ''}`}
                    onClick={() => setZoomedImage(result)}
                  >
                    <img
                      src={result.url}
                      alt={result.medium}
                      style={{ filter: getFilterStyle(activeFilter) }}
                      className={`w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 ${result.medium === 'newspaper' ? 'mix-blend-multiply opacity-90' : ''}`}
                      referrerPolicy="no-referrer"
                    />
                    {activeFilter === 'vignette' && (
                      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]" />
                    )}
                    <div className="absolute inset-0 bg-studio-ink/0 group-hover/image:bg-studio-ink/10 transition-colors flex items-center justify-center">
                      <Maximize2 className="text-white opacity-0 group-hover/image:opacity-100 transition-opacity w-10 h-10" />
                    </div>
                    {result.medium === 'newspaper' && (
                      <div className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                    )}
                    <div className="absolute top-6 left-6 bg-black/80 backdrop-blur-md px-4 py-2 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] flex items-center gap-2 shadow-sm">
                      {result.medium === 'billboard' && <Layout className="w-3 h-3" />}
                      {result.medium === 'newspaper' && <Newspaper className="w-3 h-3" />}
                      {result.medium === 'social' && <Instagram className="w-3 h-3" />}
                      {result.medium}
                    </div>
                  </div>
                  <div className="p-10">
                    <div className="mb-8">
                      <h3 className="text-[9px] font-bold uppercase tracking-[0.3em] mb-6 opacity-30 flex items-center gap-3">
                        <div className="w-4 h-[1px] bg-current" />
                        Creative Copy
                      </h3>
                      <p className={`text-xl leading-relaxed ${result.medium === 'billboard' ? 'font-serif italic' : result.medium === 'newspaper' ? 'font-serif' : 'text-sm opacity-70'}`}>
                        "{result.copy}"
                      </p>
                    </div>
                    
                    {result.medium === 'social' && (
                      <div className="flex gap-6 pt-8 border-t border-white/5">
                        <motion.div whileHover={{ scale: 1.2, y: -2 }}>
                          <Facebook className="w-4 h-4 text-white/20 hover:text-[#1877F2] transition-colors cursor-pointer" />
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.2, y: -2 }}>
                          <Twitter className="w-4 h-4 text-white/20 hover:text-[#1DA1F2] transition-colors cursor-pointer" />
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.2, y: -2 }}>
                          <Linkedin className="w-4 h-4 text-white/20 hover:text-[#0A66C2] transition-colors cursor-pointer" />
                        </motion.div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Reference Image Sidebar/Footer */}
        {(referenceImage || isGeneratingRef) && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="fixed bottom-6 right-6 w-40 md:bottom-12 md:right-12 md:w-56 bg-studio-paper p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] shadow-2xl border border-studio-ink/10 z-40 cursor-zoom-in group"
            onClick={() => referenceImage && setZoomedImage({ url: referenceImage, medium: 'social', prompt: 'Reference Shot', copy: '' })}
          >
            <div className="text-[8px] md:text-[9px] font-bold uppercase tracking-[0.3em] mb-3 md:mb-4 opacity-40 flex items-center justify-center gap-2">
              <ImageIcon className="w-2.5 h-2.5 md:w-3 md:h-3" />
              Reference
            </div>
            <div className="aspect-square rounded-xl md:rounded-2xl overflow-hidden bg-studio-bg border border-studio-ink/5 relative">
              {isGeneratingRef ? (
                <div className="w-full h-full flex items-center justify-center">
                  <motion.div
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-full h-full bg-studio-ink/5"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 md:w-6 md:h-6 text-studio-ink/20 animate-spin" />
                  </div>
                </div>
              ) : (
                <>
                  <img 
                    src={referenceImage!} 
                    alt="Reference" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 grayscale group-hover:grayscale-0"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-studio-ink/0 group-hover:bg-studio-ink/10 transition-colors flex items-center justify-center">
                    <Maximize2 className="text-white opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 md:w-6 md:h-6" />
                  </div>
                </>
              )}
            </div>
            <p className="text-[7px] md:text-[8px] mt-3 md:mt-4 leading-tight opacity-40 text-center uppercase tracking-[0.2em] font-bold">
              {isGeneratingRef ? 'Drafting...' : 'View Reference'}
            </p>
          </motion.div>
        )}

        {/* Zoom Modal */}
        <AnimatePresence>
          {zoomedImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-12 bg-studio-bg/95 backdrop-blur-xl"
              onClick={() => setZoomedImage(null)}
            >
              <button 
                className="absolute top-12 right-12 p-4 bg-studio-ink text-black rounded-full hover:bg-studio-accent transition-colors z-[110]"
                onClick={() => setZoomedImage(null)}
              >
                <X className="w-6 h-6" />
              </button>
              
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative max-w-6xl w-full bg-studio-paper rounded-[3rem] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-studio-ink/5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`flex-1 bg-studio-bg relative ${zoomedImage.medium === 'newspaper' ? 'grayscale contrast-125 brightness-95' : ''}`}>
                  <img 
                    src={zoomedImage.url} 
                    alt="Zoomed" 
                    style={{ filter: getFilterStyle(activeFilter) }}
                    className={`w-full h-full object-contain ${zoomedImage.medium === 'newspaper' ? 'mix-blend-multiply opacity-90' : ''}`}
                    referrerPolicy="no-referrer"
                  />
                  {activeFilter === 'vignette' && (
                    <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_150px_rgba(0,0,0,0.6)]" />
                  )}
                  {zoomedImage.medium === 'newspaper' && (
                    <div className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                  )}
                </div>
                
                <div className="w-full md:w-96 p-12 flex flex-col justify-center bg-studio-paper">
                  <div className="mb-12">
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] mb-6 opacity-30 flex items-center gap-3">
                      <div className="w-6 h-[1px] bg-current" />
                      Medium
                    </div>
                    <h3 className="text-4xl font-serif italic capitalize">{zoomedImage.medium}</h3>
                  </div>

                  {zoomedImage.copy && (
                    <div className="mb-12">
                      <div className="text-[10px] font-bold uppercase tracking-[0.3em] mb-6 opacity-30 flex items-center gap-3">
                        <div className="w-6 h-[1px] bg-current" />
                        Creative Copy
                      </div>
                      <p className="text-2xl font-serif italic leading-relaxed opacity-80">
                        "{zoomedImage.copy}"
                      </p>
                    </div>
                  )}

                  <div className="mt-auto pt-12 border-t border-studio-ink/5">
                    <p className="text-[10px] uppercase tracking-[0.3em] opacity-30 font-bold">
                      Brand Studio Concept
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Decoration */}
      <footer className="mt-48 py-20 border-t border-white/5 px-12 text-center">
        <div className="max-w-xs mx-auto mb-8 opacity-10">
          <Sparkles className="w-8 h-8 mx-auto" />
        </div>
        <p className="text-[10px] uppercase tracking-[0.4em] opacity-30 font-bold">
          Creative Intelligence &bull; Brand Studio 2026
        </p>
      </footer>
      </div>
    </div>
  );
}
