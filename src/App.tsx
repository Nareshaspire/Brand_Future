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
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0] p-8">
          <div className="max-w-md w-full bg-white p-8 rounded-[2.5rem] shadow-xl border border-red-100 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-light mb-4">Something went wrong</h2>
            <p className="text-sm opacity-60 mb-8 leading-relaxed">
              We encountered an unexpected error. Please try refreshing the page.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-[#1A1A1A] text-white py-4 rounded-full font-bold tracking-widest uppercase text-xs hover:bg-[#5A5A40] transition-colors"
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
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin opacity-20" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans flex items-center justify-center p-8">
        <div className="max-w-md w-full">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-12 rounded-[3rem] shadow-2xl border border-[#1A1A1A]/5 text-center"
          >
            <div className="w-16 h-16 bg-[#1A1A1A] rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl">
              <Sparkles className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-light mb-4 tracking-tight">Brand Builder</h1>
            <p className="text-sm opacity-50 mb-12 leading-relaxed">
              Sign in to start visualizing your product's future with AI-powered vision.
            </p>
            <button 
              onClick={handleLogin}
              className="w-full bg-[#1A1A1A] text-white py-5 rounded-full font-bold tracking-widest uppercase text-xs hover:bg-[#5A5A40] transition-all active:scale-95 shadow-lg flex items-center justify-center gap-3"
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
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#1A1A1A]/10 py-6 px-8 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#1A1A1A] rounded-full flex items-center justify-center">
            <Sparkles className="text-white w-4 h-4" />
          </div>
          <h1 className="text-xl font-medium tracking-tight">Brand Builder</h1>
        </div>
        
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs uppercase tracking-widest opacity-50 font-semibold hover:opacity-100 transition-opacity flex items-center gap-2"
          >
            <History className="w-4 h-4" />
            History
          </button>
          <div className="h-4 w-[1px] bg-[#1A1A1A]/10" />
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-bold uppercase tracking-widest">{user.displayName}</p>
              <button 
                onClick={handleLogout}
                className="text-[9px] uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity flex items-center gap-1 ml-auto"
              >
                <LogOut className="w-3 h-3" />
                Logout
              </button>
            </div>
            {user.photoURL ? (
              <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border border-[#1A1A1A]/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center">
                <UserIcon className="w-4 h-4 opacity-30" />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-12">
        {/* History Modal */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12 bg-[#F5F5F0]/95 backdrop-blur-xl"
              onClick={() => setShowHistory(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-4xl w-full bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-[80vh]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-8 border-b border-[#1A1A1A]/5 flex justify-between items-center">
                  <h3 className="text-2xl font-light">Campaign History</h3>
                  <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8">
                  {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-20">
                      <History className="w-12 h-12 mb-4" />
                      <p className="uppercase tracking-widest text-xs font-bold">No campaigns yet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {history.map((record) => (
                        <div 
                          key={record.id}
                          className="group bg-[#F5F5F0]/50 rounded-3xl p-6 border border-[#1A1A1A]/5 hover:bg-white hover:shadow-xl transition-all cursor-pointer relative"
                          onClick={() => loadCampaign(record)}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCampaignToDelete(record);
                            }}
                            className="absolute top-4 right-4 p-2 bg-white/80 backdrop-blur-sm text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 z-10"
                            title="Delete Campaign"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="aspect-video rounded-2xl overflow-hidden mb-4 bg-white">
                            <img src={record.referenceImage} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="Ref" />
                          </div>
                          <p className="text-xs font-bold uppercase tracking-widest opacity-30 mb-2">
                            {record.createdAt?.toDate ? record.createdAt.toDate().toLocaleDateString() : 'Recent'}
                          </p>
                          <h4 className="text-lg font-light line-clamp-1 mb-2">{record.description}</h4>
                          <div className="flex gap-2">
                            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-1 bg-[#1A1A1A]/5 rounded-md opacity-50">
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
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
              onClick={() => setCampaignToDelete(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-light mb-2">Delete Campaign?</h3>
                <p className="text-sm opacity-50 mb-8 leading-relaxed">
                  This action cannot be undone. This will permanently delete the campaign from your history.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setCampaignToDelete(null)}
                    className="flex-1 px-6 py-3 rounded-full border border-[#1A1A1A]/10 text-xs font-bold uppercase tracking-widest hover:bg-[#F5F5F0] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteCampaign(campaignToDelete.id)}
                    disabled={isDeleting}
                    className="flex-1 px-6 py-3 rounded-full bg-red-500 text-white text-xs font-bold uppercase tracking-widest hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Section */}
        <section className="mb-12">
          <div className="max-w-3xl">
            <h2 className="text-4xl font-light mb-8 leading-tight">
              Describe your product, <br />
              <span className="italic serif text-[#5A5A40]">visualize its future.</span>
            </h2>
            
            {/* Style Toggles */}
            <div className="flex flex-wrap gap-3 mb-4">
              {styles.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wider uppercase flex items-center gap-2 transition-all ${
                    selectedStyle === style.id 
                      ? 'bg-[#1A1A1A] text-white shadow-lg scale-105' 
                      : 'bg-white border border-[#1A1A1A]/10 text-[#1A1A1A]/60 hover:border-[#1A1A1A]/30'
                  }`}
                >
                  {style.icon}
                  {style.label}
                </button>
              ))}
            </div>

            {/* Filter Toggles */}
            <div className="flex flex-wrap gap-2 mb-8">
              <div className="flex items-center gap-2 mr-2 opacity-40">
                <Filter className="w-3 h-3" />
                <span className="text-[10px] uppercase font-bold tracking-widest">Filters</span>
              </div>
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all ${
                    activeFilter === filter.id 
                      ? 'bg-[#5A5A40] text-white' 
                      : 'bg-white/50 text-[#1A1A1A]/40 hover:bg-white hover:text-[#1A1A1A]/60'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setIsThinkingMode(!isThinkingMode)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all ${
                  isThinkingMode 
                    ? 'bg-[#1A1A1A] text-white shadow-md' 
                    : 'bg-white/50 text-[#1A1A1A]/40 hover:bg-white hover:text-[#1A1A1A]/60'
                }`}
                title="Enable deep reasoning for complex brand strategy"
              >
                <Brain className={`w-3 h-3 ${isThinkingMode ? 'animate-pulse' : ''}`} />
                Thinking Mode
              </button>
            </div>

            <div className="relative group">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., A sleek, minimalist obsidian water bottle with a matte finish and a copper cap..."
                className="w-full bg-white border border-[#1A1A1A]/10 rounded-2xl p-6 text-lg focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all min-h-[120px] shadow-sm group-hover:shadow-md"
              />
              <div className="absolute bottom-4 right-4 flex gap-3">
                <button
                  onClick={generateReference}
                  disabled={isGeneratingRef || isGeneratingCampaign || !description.trim()}
                  className="bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] px-6 py-3 rounded-full flex items-center gap-2 hover:bg-[#F5F5F0] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-sm"
                >
                  {isGeneratingRef ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Drafting...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Reference
                    </>
                  )}
                </button>
                <button
                  onClick={generateCampaign}
                  disabled={isGeneratingRef || isGeneratingCampaign || !description.trim() || !referenceImage}
                  className="bg-[#1A1A1A] text-white px-6 py-3 rounded-full flex items-center gap-2 hover:bg-[#5A5A40] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg"
                >
                  {isGeneratingCampaign ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Launching...
                    </>
                  ) : (
                    <>
                      Generate Campaign
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Brand Guidelines Section (Editable & Collapsible) */}
        <section className="mb-16">
          <div className="bg-white rounded-[2.5rem] border border-[#1A1A1A]/5 shadow-sm overflow-hidden">
            <button 
              onClick={() => setIsGuidelinesOpen(!isGuidelinesOpen)}
              className="w-full p-8 flex items-center justify-between hover:bg-[#F5F5F0]/30 transition-colors"
            >
              <div className="flex items-center gap-3 opacity-40 uppercase tracking-[0.2em] text-[10px] font-bold">
                <div className="w-4 h-[1px] bg-current" />
                Brand Identity Guidelines
              </div>
              <motion.div
                animate={{ rotate: isGuidelinesOpen ? 180 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <ArrowRight className="w-4 h-4 rotate-90 opacity-30" />
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
                  <div className="px-8 pb-12 grid grid-cols-1 md:grid-cols-3 gap-12 border-t border-[#1A1A1A]/5 pt-8">
                    {/* Colors */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-50">Color Palette</h4>
                      <div className="flex gap-4">
                        {guidelines.colors.map((color, idx) => (
                          <div key={`color-input-${idx}`} className="flex flex-col gap-2">
                            <div 
                              className="w-12 h-12 rounded-2xl border border-[#1A1A1A]/5 shadow-inner relative overflow-hidden" 
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
                              className="text-[9px] font-mono w-12 bg-transparent border-none focus:outline-none opacity-40 hover:opacity-100 transition-opacity text-center"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Fonts */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-50">Typography</h4>
                      <input 
                        type="text"
                        value={guidelines.fonts}
                        onChange={(e) => updateGuideline('fonts', e.target.value)}
                        placeholder="e.g., Inter & Cormorant Garamond"
                        className="w-full bg-transparent border-b border-[#1A1A1A]/10 py-1 text-lg serif italic text-[#5A5A40] focus:outline-none focus:border-[#5A5A40] transition-colors"
                      />
                    </div>

                    {/* Tone */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-50">Tone of Voice</h4>
                      <textarea 
                        value={guidelines.tone}
                        onChange={(e) => updateGuideline('tone', e.target.value)}
                        placeholder="e.g., Sophisticated and minimalist."
                        className="w-full bg-transparent border-b border-[#1A1A1A]/10 py-1 text-sm leading-relaxed opacity-70 focus:outline-none focus:border-[#5A5A40] transition-colors resize-none h-20"
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
            className="mb-8 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm"
          >
            {error}
          </motion.div>
        )}

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <AnimatePresence mode="popLayout">
            {isGeneratingCampaign && !results.length && (
              [1, 2, 3].map((i) => (
                <motion.div
                  key={`skeleton-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="aspect-square bg-white border border-[#1A1A1A]/5 rounded-3xl flex flex-col items-center justify-center gap-4 animate-pulse"
                >
                  <div className="w-12 h-12 bg-[#1A1A1A]/5 rounded-full" />
                  <div className="h-4 w-32 bg-[#1A1A1A]/5 rounded-full" />
                </motion.div>
              ))
            )}

            {results.map((result, idx) => (
              <motion.div
                key={result.medium}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                className="group relative"
              >
                <div className="bg-white rounded-[2rem] overflow-hidden shadow-sm border border-[#1A1A1A]/5 transition-all hover:shadow-xl hover:-translate-y-1">
                  <div 
                    className={`aspect-square relative overflow-hidden bg-[#F0F0F0] cursor-zoom-in group/image ${result.medium === 'newspaper' ? 'grayscale contrast-125 brightness-95' : ''}`}
                    onClick={() => setZoomedImage(result)}
                  >
                    <img
                      src={result.url}
                      alt={result.medium}
                      style={{ filter: getFilterStyle(activeFilter) }}
                      className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${result.medium === 'newspaper' ? 'mix-blend-multiply opacity-90' : ''}`}
                      referrerPolicy="no-referrer"
                    />
                    {activeFilter === 'vignette' && (
                      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]" />
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/10 transition-colors flex items-center justify-center">
                      <Maximize2 className="text-white opacity-0 group-hover/image:opacity-100 transition-opacity w-8 h-8" />
                    </div>
                    {result.medium === 'newspaper' && (
                      <div className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                    )}
                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-sm">
                      {result.medium === 'billboard' && <Layout className="w-3 h-3" />}
                      {result.medium === 'newspaper' && <Newspaper className="w-3 h-3" />}
                      {result.medium === 'social' && <Instagram className="w-3 h-3" />}
                      {result.medium}
                    </div>
                  </div>
                  <div className="p-8">
                    <div className="mb-6">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 opacity-30 flex items-center gap-2">
                        <div className="w-3 h-[1px] bg-current" />
                        Ad Copy Draft
                      </h3>
                      <p className={`text-lg leading-snug ${result.medium === 'billboard' ? 'font-bold tracking-tight' : result.medium === 'newspaper' ? 'serif italic' : 'text-sm opacity-80'}`}>
                        "{result.copy}"
                      </p>
                    </div>
                    
                    {result.medium === 'social' && (
                      <div className="flex gap-4 pt-6 border-t border-[#1A1A1A]/5">
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
                          whileHover={{ scale: 1.2 }}
                        >
                          <Facebook className="w-4 h-4 text-[#1A1A1A]/20 hover:text-[#1877F2] transition-colors cursor-pointer" />
                        </motion.div>
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}
                          whileHover={{ scale: 1.2 }}
                        >
                          <Twitter className="w-4 h-4 text-[#1A1A1A]/20 hover:text-[#1DA1F2] transition-colors cursor-pointer" />
                        </motion.div>
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.3 }}
                          whileHover={{ scale: 1.2 }}
                        >
                          <Linkedin className="w-4 h-4 text-[#1A1A1A]/20 hover:text-[#0A66C2] transition-colors cursor-pointer" />
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
            className="fixed bottom-8 right-8 w-48 bg-white p-4 rounded-3xl shadow-2xl border border-[#1A1A1A]/10 z-40 cursor-zoom-in group"
            onClick={() => referenceImage && setZoomedImage({ url: referenceImage, medium: 'social', prompt: 'Reference Shot', copy: '' })}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest mb-3 opacity-40 flex items-center justify-center gap-2">
              <ImageIcon className="w-3 h-3" />
              Reference Shot
            </div>
            <div className="aspect-square rounded-xl overflow-hidden bg-[#F0F0F0] border border-[#1A1A1A]/5 relative">
              {isGeneratingRef ? (
                <div className="w-full h-full flex items-center justify-center">
                  <motion.div
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-full h-full bg-[#1A1A1A]/5"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-[#1A1A1A]/20 border-t-[#1A1A1A] rounded-full animate-spin" />
                  </div>
                </div>
              ) : (
                <>
                  <img 
                    src={referenceImage!} 
                    alt="Reference" 
                    className="w-full h-full object-cover transition-transform group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <Maximize2 className="text-white opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4" />
                  </div>
                </>
              )}
            </div>
            <p className="text-[10px] mt-3 leading-tight opacity-50 text-center">
              {isGeneratingRef ? 'Generating reference...' : 'Click to enlarge reference'}
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
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-12 bg-[#F5F5F0]/95 backdrop-blur-xl"
              onClick={() => setZoomedImage(null)}
            >
              <button 
                className="absolute top-8 right-8 p-3 bg-[#1A1A1A] text-white rounded-full hover:bg-[#5A5A40] transition-colors z-[110]"
                onClick={() => setZoomedImage(null)}
              >
                <X className="w-6 h-6" />
              </button>
              
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-5xl w-full bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col md:flex-row"
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`flex-1 bg-[#F0F0F0] relative ${zoomedImage.medium === 'newspaper' ? 'grayscale contrast-125 brightness-95' : ''}`}>
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
                
                <div className="w-full md:w-80 p-8 md:p-12 flex flex-col justify-center bg-white">
                  <div className="mb-8">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 opacity-30 flex items-center gap-2">
                      <div className="w-4 h-[1px] bg-current" />
                      Medium
                    </div>
                    <h3 className="text-2xl font-light capitalize">{zoomedImage.medium}</h3>
                  </div>

                  {zoomedImage.copy && (
                    <div className="mb-8">
                      <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 opacity-30 flex items-center gap-2">
                        <div className="w-4 h-[1px] bg-current" />
                        Ad Copy
                      </div>
                      <p className="text-lg serif italic leading-relaxed opacity-80">
                        "{zoomedImage.copy}"
                      </p>
                    </div>
                  )}

                  <div className="mt-auto pt-8 border-t border-[#1A1A1A]/5">
                    <p className="text-[10px] uppercase tracking-widest opacity-30 font-bold">
                      Brand Builder Concept
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Decoration */}
      <footer className="mt-24 py-12 border-t border-[#1A1A1A]/10 px-8 text-center">
        <p className="text-xs uppercase tracking-[0.2em] opacity-30">
          Built with Gemini Nano-Banana &bull; No People Policy Enforced
        </p>
      </footer>
    </div>
  );
}
