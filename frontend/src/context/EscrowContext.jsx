import { createContext, useContext, useEffect, useState } from "react";

const EscrowContext = createContext();

export function EscrowProvider({ children }) {

  const [escrowData, setEscrowData] = useState({

    buyerName: "",

    sellerName: "",

    productName: "",

    productId: "",

    amount: "",

    assetSymbol: "USDC",

    assetDecimals: 6,

    description: "",

    expiry: "",

    escrowId: "",

    verificationCode: "",

    status: "Pending"

  });

  const [allEscrows, setAllEscrows] = useState(() => {

    const savedEscrows = localStorage.getItem("proofpay-escrows");

    return savedEscrows ? JSON.parse(savedEscrows) : [];

  });

  useEffect(() => {

    localStorage.setItem(
      "proofpay-escrows",
      JSON.stringify(allEscrows)
    );

  }, [allEscrows]);



  function saveEscrow(newEscrow) {

    setEscrowData(newEscrow);

    setAllEscrows((previousEscrows) => [

      ...previousEscrows,

      newEscrow,

    ]);

  }

  function updateEscrow(updatedEscrow) {

    setEscrowData(updatedEscrow);

    setAllEscrows((previousEscrows) =>

      previousEscrows.map((escrow) =>

        escrow.escrowId === updatedEscrow.escrowId

          ? updatedEscrow

          : escrow

      )

    );

  }

  function clearEscrows() {

    setAllEscrows([]);

    localStorage.removeItem("proofpay-escrows");

  }

  return (

    <EscrowContext.Provider
      value={{

        escrowData,

        setEscrowData,

        allEscrows,

        setAllEscrows,

        saveEscrow,

        updateEscrow,

        clearEscrows,

      }}
    >      {children}

    </EscrowContext.Provider>

  );

}

export function useEscrow() {

  return useContext(EscrowContext);

}
