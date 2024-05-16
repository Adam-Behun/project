import torch
from transformers import T5ForConditionalGeneration, T5Tokenizer

# Loading the pre-trained model
model_name = "t5-small"
tokenizer = T5Tokenizer.from_pretrained(model_name)
model = T5ForConditionalGeneration.from_pretrained(model_name)

def translate_to_sql(query):

    # prepends an instruction to the query
    input_text = "translate English to SQL: " + query

    #encode into token ids
    input_ids = tokenizer.encode(input_text, return_tensors="pt")

    # pre-trained T5 model generates the query
    outputs = model.generate(input_ids)

    # decodes from tokens to into string
    sql_query = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return sql_query