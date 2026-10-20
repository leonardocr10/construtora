export type UnitStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
export type Point = [number, number];

export interface UnitSlot { final: string; side: 'front' | 'back'; column: number }
export interface TowerModel { width: number; depth: number; elevators?: number; colors?: { facade?: string; accent?: string; roof?: string; base?: string }; unitSlots?: UnitSlot[] }

export interface Unit { id: string; number: string; final: string | null; floor: number | null; status: UnitStatus; privateArea: number | null; totalArea: number | null; price: number | null; floorPlanId: string | null }
export interface Building {
  id: string; name: string; code: string;
  position: { x: number; z: number; rotation?: number } | null;
  floorCount: number | null; unitsPerFloor: number | null; floorHeight: number | null;
  model3d: TowerModel | null; floors: { id: string; name: string; number: number }[]; units: Unit[];
}
export interface FloorPlan { id: string; name: string; code: string | null; area: number | null; bedrooms: number | null; suites: number | null; bathrooms: number | null; parkingSpaces: number | null; description: string | null; imageAssetIds: string[]; layout: PlanLayout | null }
/** Planta vetorizada em metros (origem no canto superior esquerdo da imagem; y para baixo). */
export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'suite' | 'bathroom' | 'balcony' | 'service' | 'hall' | 'garden';
export interface PlanLayout {
  version: 1; wallHeight: number;
  walls: { id: string; a: Point; b: Point; thickness: number }[];
  openings: { id: string; wallId: string; offset: number; width: number; kind: 'door' | 'window' | 'sliding'; sill?: number; height?: number }[];
  rooms: { id: string; name: string; kind: RoomKind; points: Point[] }[];
}
export interface Amenity { id: string; name: string; description: string | null; marker: number | null; position: { x: number; z: number } | null; mediaAssetIds: string[] }
export interface SiteLayout {
  siteImageAssetId?: string; imageWidth: number; imageHeight: number; metersPerPixel: number; origin: Point; azimuth: number;
  lot?: Point[]; roads?: { name: string; points: Point[] }[]; showPrices?: boolean; notes?: string[];
  /** Raio (px) dos círculos numerados impressos na arte, apagados na textura. */
  markerRadius?: number;
}
export interface Development {
  id: string; slug: string; name: string; description: string | null; address: string | null; city: string | null; state: string | null;
  latitude: number | null; longitude: number | null; deliveryDate: string | null; coverAssetId: string | null;
  contact: { phone: string | null; email: string | null; whatsapp: string | null; site: string | null } | null;
  theme: { primaryColor: string; secondaryColor: string; fontFamily: string; logoAssetId: string | null } | null;
  viewer: { camera: { distance?: number; polar?: number; azimuth?: number } | null; lighting: { mode?: 'day' | 'sunset' } | null; layout: SiteLayout | null; modelAssetId: string | null };
  buildings: Building[]; floorPlans: FloorPlan[]; amenities: Amenity[];
  gallery: { id: string; kind: string; originalName: string; metadata: { title?: string } | null }[];
}
export interface Surroundings {
  attribution: string; radius: number;
  roads: { kind: string; name: string | null; points: Point[] }[];
  buildings: { points: Point[]; height: number }[];
  water: { points: Point[]; name: string | null }[];
  green: { points: Point[]; kind: string; name: string | null }[];
}
