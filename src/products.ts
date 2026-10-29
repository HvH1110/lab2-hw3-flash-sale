import type { Product } from './sale/types';

/** Fictional catalogue for the 11.11 simulation (no real brands). */
export const PRODUCTS: readonly Product[] = Object.freeze([
  { id: 'phone-x5', name: 'Điện thoại Sao Mai X5 128GB', category: 'Công nghệ', originalPrice: 8_990_000, salePrice: 3_990_000, stock: 30, perCustomerLimit: 1 },
  { id: 'earbuds', name: 'Tai nghe không dây Gió Biển', category: 'Công nghệ', originalPrice: 1_290_000, salePrice: 390_000, stock: 60, perCustomerLimit: 2 },
  { id: 'air-fryer', name: 'Nồi chiên không dầu 5L', category: 'Gia dụng', originalPrice: 2_490_000, salePrice: 990_000, stock: 25, perCustomerLimit: 1 },
  { id: 'rice-st25', name: 'Gạo ST25 túi 5kg', category: 'Thực phẩm', originalPrice: 230_000, salePrice: 159_000, stock: 120, perCustomerLimit: 3 },
  { id: 'ao-dai', name: 'Áo dài lụa Hội An', category: 'Thời trang', originalPrice: 1_800_000, salePrice: 899_000, stock: 15, perCustomerLimit: 1 },
  { id: 'helmet', name: 'Mũ bảo hiểm 3/4 đầu', category: 'Phụ kiện', originalPrice: 450_000, salePrice: 149_000, stock: 40, perCustomerLimit: 2 },
  { id: 'coffee', name: 'Cà phê phin Buôn Ma Thuột 500g', category: 'Thực phẩm', originalPrice: 180_000, salePrice: 99_000, stock: 80, perCustomerLimit: 2 },
  { id: 'keyboard', name: 'Bàn phím cơ Sông Hàn TKL', category: 'Công nghệ', originalPrice: 1_590_000, salePrice: 690_000, stock: 20, perCustomerLimit: 1 },
].map((p) => Object.freeze(p)));

const vnd = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
export const formatVnd = (value: number): string => vnd.format(value);
export const discountPercent = (p: Product): number => Math.round(((p.originalPrice - p.salePrice) / p.originalPrice) * 100);
