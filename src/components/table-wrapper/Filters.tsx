/* eslint-disable */
import Box from "@components/container/Box";
import { FiltersType } from "@/types/app.type";
import {
  AccordionController,
  AccordionCard,
  AccordionCardContent,
  AccordionCardTitle,
  useForm,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import { FilterIcon } from "@netapp/bxp-style/react-icons/Action";
import { nanoid } from "@reduxjs/toolkit";
import { useEffect, useState } from "react";
import { Button } from "@netapp/bxp-design-system-react";

const Filters = ({
  rows,
  columnsToFilter,
  setFilters,
  preSelectedFilter,
}: FiltersType) => {
  const [dataToFilter, setDataToFilter] = useState<any>({});

  useEffect(() => {
    let dataToUpdate: any = {};
    columnsToFilter?.forEach(({ accessor }) => {
      dataToUpdate[accessor] = Array.from(
        new Set(rows.map((item: any) => item[accessor]))
      );
    });
    setDataToFilter(dataToUpdate);
  }, [columnsToFilter, rows]);

const getLabelValueObject = (value?: string, formatter?: Function) => 
  value ? [{ label: formatter ? formatter(value) : value, value }] : [];


  const form = useForm(
    columnsToFilter?.reduce(
      (filterForm, { accessor: fileName, label: label, formatter: formatter }) => ({
        ...filterForm,
        [fileName]: getLabelValueObject(preSelectedFilter?.[fileName], formatter),
      }),
      {}
    )
  );

  useEffect(() => {
    setFilters && setFilters(form.formState);
  }, [form]);

  const formatOptions = (data: any[], formatter?: Function) => {
    let options: { value: string; label: string }[] = [];
    data.forEach((value) => {
      if (!value) return;
      options.push(getOptionFormatting(value, formatter));
    });
    return options;
  };

  const getOptionFormatting = (value: any, formatter?: Function) => {
    value = value.toString();
    return {
      label: formatter ? formatter(value) : value,
      value,
    };
  };

  const resetForm = () => {
    form.resetForm(
      columnsToFilter?.reduce(
        (filterForm, { accessor: fileName }) => ({
          ...filterForm,
          [fileName]: getLabelValueObject(preSelectedFilter?.[fileName]),
        }),
        {}
      )
    );
  };

  return (
    <Box className="mb-8">
      <AccordionController>
        <AccordionCard>
          <AccordionCardTitle>
            <Box className="flex justify-center">
              <FilterIcon />
              <span className="px-4">Filters</span>
            </Box>
          </AccordionCardTitle>
          <AccordionCardContent>
            <Box className="flex flex-col">
              <Box className="flex gap-4">
                {columnsToFilter?.map(({ accessor, label, formatter }) => (
                  <FormFieldSelect
                    key={nanoid()}
                    label={label}
                    name={accessor}
                    isSearchable={true}
                    form={form}
                    labelClassName="capitalize"
                    isMulti={true}
                    isClearable={true}
                    options={formatOptions(
                      dataToFilter?.[accessor] || [],
                      formatter
                    )}
                  />
                ))}
              </Box>
              <Button
                className="float-right justify-end"
                variant="text"
                onClick={resetForm}
              >
                Clear all
              </Button>
            </Box>
          </AccordionCardContent>
        </AccordionCard>
      </AccordionController>
    </Box>
  );
};

export default Filters;
