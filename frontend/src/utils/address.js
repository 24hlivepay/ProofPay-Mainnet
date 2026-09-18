export function shortenAddress(address, front = 6, back = 4) {
  if (!address) return "";
  if (address.length <= front + back + 3) return address;

  return `${address.slice(0, front)}...${address.slice(-back)}`;
}
