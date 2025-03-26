import { Box } from "@components/container/index";
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
import { useEffect } from "react";
import { TaskFilterOption, TaskFiltersType } from "./tasks.interface";
import { Button } from "@netapp/bxp-design-system-react";

const getLabelValueObject = (
  value?: string,
  formatter?: (value: string) => string
): TaskFilterOption[] =>
  value ? [{ label: formatter ? formatter(value) : value, value }] : [];

const TaskFilters = ({
  columnsToFilter,
  setFilters,
  preSelectedFilter,
}: TaskFiltersType) => {
  const form = useForm(
    columnsToFilter?.reduce(
      (filterForm, { accessor: fileName, formatter }) => ({
        ...filterForm,
        [fileName]: getLabelValueObject(
          preSelectedFilter?.[fileName],
          formatter
        ),
      }),
      {}
    )
  );

  useEffect(() => {
    if (setFilters) {
      setFilters(form.formState);
    }
  }, [form]);

  const formatOptions = (
    data: string[],
    formatter?: (value: string) => string
  ): TaskFilterOption[] => {
    const options: TaskFilterOption[] = [];
    data.forEach((value) => {
      if (!value) return;
      options.push(getOptionFormatting(value, formatter));
    });
    return options;
  };

  const getOptionFormatting = (
    value: string,
    formatter?: (value: string) => string
  ): TaskFilterOption => ({
    label: formatter ? formatter(value) : value,
    value,
  });

  const resetForm = () => {
    form.resetForm(
      columnsToFilter?.reduce(
        (filterForm, { accessor: fileName }) => ({
          ...filterForm,
          [fileName]: getLabelValueObject(),
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
                {columnsToFilter?.map(
                  ({ accessor, label, options, formatter }) => (
                    <FormFieldSelect
                      key={nanoid()}
                      label={label}
                      name={accessor}
                      isSearchable={true}
                      form={form}
                      labelClassName="capitalize"
                      isMulti={true}
                      isClearable={true}
                      options={formatOptions(options || [], formatter)}
                    />
                  )
                )}
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

export default TaskFilters;
