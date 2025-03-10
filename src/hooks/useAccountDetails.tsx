// interface AccountDetailsType {
//   id: string;
//   [key: string]: any;
// }

const useAccountDetails = () => {
  // const [fetchAllAccounts, { isLoading, error }] = useLazyGetAllAccountsQuery();
  // const [accountDetails, setAccountDetails] =
  //   useState<accountDetailsType | null>(null);

  // useEffect(() => {
  //   (async () => {
  //     const resp = await fetchAllAccounts("").unwrap();
  //     console.log(resp);
  //     setAccountDetails(resp?.[0]);
  //   })();
  // }, [fetchAllAccounts]);

  return {
    accountDetails: { id: import.meta.env.VITE_HARD_CODE_ACCOUNT_ID },
    isLoading: false,
    error: null,
  };
};

export default useAccountDetails;
